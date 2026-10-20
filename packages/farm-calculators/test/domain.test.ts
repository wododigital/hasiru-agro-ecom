import { describe, expect, it } from 'vitest';
import {
  convertArea,
  dosageRuleSchema,
  linesFromSizes,
  packsFor,
  plantCalcInputSchema,
  plantCount,
  recommendInputs,
  suggestedSpacing,
  type DosageRule,
} from '../src/domain';
import { fill } from '../src/messages';

const calc = (o: Partial<Parameters<typeof plantCount>[0]>) => plantCount({ area: 1, unit: 'acre', lengthFt: 18, widthFt: 18, layout: 'square', buffer: false, ...o });

describe('plant calculator (A10)', () => {
  it('SRS acceptance: 1 acre at 9 x 9 ft is 538 plants and at 10 x 10 ft is 436', () => {
    expect(calc({ lengthFt: 9, widthFt: 9 }).base).toBe(538);
    expect(calc({ lengthFt: 10, widthFt: 10 }).base).toBe(436);
    expect(calc({ lengthFt: 9, widthFt: 9 }).perAcre).toBe(538);
  });

  it('the 3% buffer is ceil(n x 1.03) with integer maths', () => {
    expect(calc({ lengthFt: 9, widthFt: 9, buffer: true }).total).toBe(555); // 538 x 1.03 = 554.14
    expect(calc({ lengthFt: 10, widthFt: 10, buffer: true }).total).toBe(450); // 436 x 1.03 = 449.08
    // 100 x 1.03 is 103.00000000000001 in floating point; the count must stay 103.
    expect(calc({ area: 100 * 100, unit: 'sqft', lengthFt: 10, widthFt: 10, buffer: true })).toMatchObject({ base: 100, total: 103 });
  });

  it('triangular fits 1.155x, rounded once', () => {
    expect(calc({ lengthFt: 10, widthFt: 10, layout: 'triangular' }).base).toBe(Math.round(435.6 * 1.155));
    expect(calc({ lengthFt: 18, widthFt: 18 }).base).toBe(134);
    expect(calc({ lengthFt: 18, widthFt: 18, layout: 'triangular', buffer: true }).total).toBe(Math.ceil((Math.round(134.444 * 1.155) * 103) / 100));
  });

  it('square feet and acres give the same answer; zero land is zero plants', () => {
    expect(calc({ area: 43_560, unit: 'sqft', lengthFt: 9, widthFt: 9 }).base).toBe(538);
    expect(calc({ area: 0 })).toMatchObject({ base: 0, total: 0 });
  });

  it('unit toggle converts the field like the prototype (sq ft whole, acres 2 decimals)', () => {
    expect(convertArea(1, 'acre', 'sqft')).toBe(43_560);
    expect(convertArea(10_000, 'sqft', 'acre')).toBe(0.23);
    expect(convertArea(2.5, 'acre', 'acre')).toBe(2.5);
  });

  it('input schema falls back to safe values instead of NaN', () => {
    expect(plantCalcInputSchema.parse({ area: 'abc', unit: 'hectare', lengthFt: 0, widthFt: '12', layout: 'x', buffer: 'yes' })).toEqual({
      area: 0,
      unit: 'acre',
      lengthFt: 18,
      widthFt: 12,
      layout: 'square',
      buffer: true,
    });
  });

  it('suggested spacing: preferred area model first, line models ignored', () => {
    expect(suggestedSpacing({ boundary: 10, food_forest: [18, 18], commercial: [12, 20] }, ['commercial', 'food_forest'])).toEqual([12, 20]);
    expect(suggestedSpacing({ boundary: 10, miyawaki: [3, 3] }, ['commercial'])).toEqual([3, 3]);
    expect(suggestedSpacing({ boundary: 10, commercial: null }, ['commercial'])).toBeNull();
    expect(suggestedSpacing(null)).toBeNull();
  });
});

// The plan's default rules (5.2 "Recommended inputs") as fixtures.
const V = '00000000-0000-7000-8000-000000000001';
const B = '00000000-0000-7000-8000-000000000002';
const N = '00000000-0000-7000-8000-000000000003';
const J = '00000000-0000-7000-8000-000000000004';
const G = '00000000-0000-7000-8000-000000000005';
const C = '00000000-0000-7000-8000-000000000006';
const rule = (o: Record<string, unknown>): DosageRule => dosageRuleSchema.parse({ isActive: true, ...o });
const planRules: DosageRule[] = [
  rule({ inputProductId: V, role: 'M', amount: 2, packSize: 25, position: 1 }),
  rule({ inputProductId: V, role: 'X', amount: 1, packSize: 25, position: 1 }),
  rule({ inputProductId: V, role: 'O', amount: 0.5, packSize: 25, position: 1 }),
  rule({ inputProductId: B, role: 'M', amount: 1, packSize: 10, position: 2 }),
  rule({ inputProductId: B, role: 'X', amount: 0.5, packSize: 10, position: 2 }),
  rule({ inputProductId: B, role: 'O', amount: 0.25, packSize: 10, position: 2 }),
  rule({ inputProductId: N, role: 'any', amount: 0.25, packSize: 25, position: 3 }),
  rule({ inputProductId: J, basis: 'per_acre', amount: 20, packSize: 5, unit: 'L', minPacks: 1, position: 4 }),
  rule({ inputProductId: G, basis: 'per_acre', amount: 10, packSize: 1, position: 5 }),
];
const packs = (needs: ReturnType<typeof recommendInputs>) => Object.fromEntries(needs.map((n) => [n.inputProductId, n.packs]));

describe('recommended inputs (dosage rounding)', () => {
  it('reproduces the plan formulas for a mixed planting on 1 acre', () => {
    const plants = [
      { qty: 120, role: 'M' as const },
      { qty: 300, role: 'X' as const },
      { qty: 185, role: 'O' as const },
    ];
    const q = 120 + 300 + 185;
    const out = recommendInputs({ plants, acres: 1, rules: planRules });
    expect(packs(out)).toEqual({
      [V]: Math.ceil((120 * 2 + 300 * 1 + 185 * 0.5) / 25), // 632.5 kg -> 26
      [B]: Math.ceil((120 * 1 + 300 * 0.5 + 185 * 0.25) / 10), // 316.25 kg -> 32
      [N]: Math.ceil((0.25 * q) / 25), // 151.25 kg -> 7
      [J]: Math.max(1, Math.ceil(1 * 4)),
      [G]: 10,
    });
    expect(out.map((n) => n.inputProductId)).toEqual([V, B, N, J, G]);
    expect(out[0]).toMatchObject({ amount: 632.5, unit: 'kg', packSize: 25 });
  });

  it('per-acre inputs keep their minimum on small land and scale with acres', () => {
    expect(packs(recommendInputs({ plants: [], acres: 0.1, rules: planRules }))).toEqual({ [J]: 1, [G]: 1 });
    expect(packs(recommendInputs({ plants: [], acres: 2.3, rules: planRules }))[J]).toBe(Math.max(1, Math.ceil(2.3 * 4)));
    expect(recommendInputs({ plants: [], acres: 0, rules: planRules })).toEqual([]);
  });

  it('exact whole packs never round up through floating dust', () => {
    expect(packsFor(25, 25)).toBe(1);
    expect(packsFor(0.1 * 3 * 100, 10)).toBe(3); // 30.000000000000004
    expect(packsFor(25.01, 25)).toBe(2);
    expect(packsFor(0, 25, 1)).toBe(0);
    // 100 O-role plants: 0.25 kg x 100 = 25 kg biochar, exactly 3 bags of 10 kg (2.5 -> 3)
    expect(packs(recommendInputs({ plants: [{ qty: 100, role: 'O' }], acres: 0, rules: planRules }))[B]).toBe(3);
  });

  it('inactive rules and other age bands are ignored; an exact role beats `any`', () => {
    const rules = [
      ...planRules,
      rule({ inputProductId: N, role: 'M', amount: 1, packSize: 25, position: 3 }),
      rule({ inputProductId: V, role: 'M', ageBand: 'y3_6', amount: 8, packSize: 25 }),
      rule({ inputProductId: C, role: 'any', amount: 5, packSize: 50, isActive: false }),
    ];
    const out = packs(recommendInputs({ plants: [{ qty: 25, role: 'M' }, { qty: 100, role: 'X' }], acres: 0, rules }));
    expect(out[N]).toBe(Math.ceil((25 * 1 + 100 * 0.25) / 25)); // 50 kg -> 2
    expect(out[V]).toBe(Math.ceil((25 * 2 + 100) / 25));
    expect(out[C]).toBeUndefined();
    expect(packs(recommendInputs({ plants: [{ qty: 10, role: 'M' }], acres: 0, rules, ageBand: 'y3_6' }))).toEqual({ [V]: Math.ceil(80 / 25) });
  });

  it("a compost rule uses the plant's own at-planting kg when the catalogue has it", () => {
    const rules = [rule({ inputProductId: C, role: 'any', amount: 1, packSize: 50, usePlantCompost: true })];
    const out = recommendInputs({ plants: [{ qty: 10, role: 'M', compostKg: 5 }, { qty: 20, role: 'O', compostKg: null }], acres: 0, rules });
    expect(out).toEqual([{ inputProductId: C, amount: 70, unit: 'kg', packSize: 50, packs: 2 }]);
  });

  it('compost calculator by size class maps L/M/S to M/X/O (A12)', () => {
    const lines = linesFromSizes({ L: 10, M: 100, S: 7.9 });
    expect(lines).toEqual([
      { qty: 10, role: 'M' },
      { qty: 100, role: 'X' },
      { qty: 7, role: 'O' },
    ]);
    const vermi = recommendInputs({ plants: lines, acres: 0, rules: planRules }).find((n) => n.inputProductId === V)!;
    expect(vermi).toMatchObject({ amount: 10 * 2 + 100 * 1 + 7 * 0.5, packs: Math.ceil(123.5 / 25) });
  });

  it('admin rule schema reads checkboxes and rejects nonsense', () => {
    const parsed = dosageRuleSchema.parse({ inputProductId: V, amount: '2', packSize: '25', isActive: 'on' });
    expect(parsed).toMatchObject({ basis: 'per_plant', role: 'any', ageBand: 'at_planting', amount: 2, packSize: 25, minPacks: 0, isActive: true, usePlantCompost: false });
    expect(dosageRuleSchema.safeParse({ inputProductId: V, amount: -1, packSize: 25 }).success).toBe(false);
    expect(dosageRuleSchema.safeParse({ inputProductId: V, amount: 1, packSize: 0 }).success).toBe(false);
    expect(dosageRuleSchema.safeParse({ inputProductId: 'x', amount: 1, packSize: 1 }).success).toBe(false);
  });
});

describe('message templates', () => {
  it('fills placeholders with en-IN grouping', () => {
    expect(fill('Add {count} to cart', { count: 12345 })).toBe('Add 12,345 to cart');
    expect(fill('{a} and {missing}', { a: 'x' })).toBe('x and {missing}');
  });
});
