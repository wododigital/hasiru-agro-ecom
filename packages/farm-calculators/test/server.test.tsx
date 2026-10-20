import { eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setAuthProvider } from '@ecomkit/core/auth-context';
import { coreAuditLog } from '@ecomkit/core/schema';
import type { TestDb } from '@ecomkit/core/testing';
import { deleteRuleAction, saveRuleAction } from '../src/admin/actions';
import DosageRulesPage from '../src/admin/DosageRulesPage';
import { farmcalcDosageRule } from '../src/schema';
import {
  compostCalculatorData,
  configureFarmCalculators,
  deleteDosageRule,
  DuplicateRuleError,
  listDosageRulesFresh,
  plantCalculatorData,
  plantLinesFor,
  recommendedInputs,
  rulesFromProduct,
  saveDosageRule,
  seedDosageRules,
} from '../src/server';
import { GET } from '../src/routes/api-calculator-plants';
import CompostCalculatorPage from '../src/routes/calculators-compost';
import PlantCalculatorPage, { generateMetadata } from '../src/routes/calculators-plants';
import { CompostCalculatorIsland, PlantCalculatorIsland } from '../src/ui';
import { farmCalculatorsMessages } from '../src/messages';
import { calcDb, MANAGER, renderHtml, seedCatalog, setPrice, signInAs, SUPPORT } from './helpers';

let t: TestDb;
let ids: Record<string, string>;
let variants: Record<string, string>;
const log = { info: () => {}, warn: () => {}, error: () => {} };
const ctx = (dryRun = false) => ({ seedDir: '/nonexistent', mediaDir: '/nonexistent', dryRun, log });

beforeAll(async () => {
  t = await calcDb('server');
  ({ ids, variants } = await seedCatalog());
  await setPrice(ids['Tall Fruit Tree']!, variants['Tall Fruit Tree']!, 30_000, [{ minQty: 50, unitPaise: 25_000 }]);
  await setPrice(ids['Worm Compost']!, variants['Worm Compost']!, 45_000);
}, 180_000);

afterAll(async () => {
  setAuthProvider(async () => null);
  await t?.close();
});

describe('seed hook', () => {
  it('dry run counts rules and writes nothing', async () => {
    const r = await seedDosageRules(ctx(true));
    expect(r.inserted).toBe(0);
    expect(r.skipped).toBe(3 + 3 + 1 + 1 + 1 + 1);
    expect(await t.db.select().from(farmcalcDosageRule)).toHaveLength(0);
  });

  it('imports the dosage data from input products, skipping derived per-block rules', async () => {
    const r = await seedDosageRules(ctx());
    expect(r).toMatchObject({ inserted: 10, updated: 0, skipped: 0 });
    const rules = await listDosageRulesFresh();
    const of = (name: string) => rules.filter((x) => x.inputProductId === ids[name]);
    expect(of('Worm Compost').map((x) => [x.role, x.amount, x.packSize]).sort()).toEqual([
      ['M', 2, 25],
      ['O', 0.5, 25],
      ['X', 1, 25],
    ]);
    expect(of('Seed Cake')).toMatchObject([{ role: 'any', basis: 'per_plant', amount: 0.25 }]);
    expect(of('Liquid Feed')).toMatchObject([{ basis: 'per_acre', unit: 'L', amount: 20, packSize: 5, minPacks: 1 }]);
    expect(of('Cover Seed')).toHaveLength(1);
    expect(of('Farm Compost')).toMatchObject([{ usePlantCompost: true, amount: 1, packSize: 50 }]);
  });

  it('a second run changes nothing and keeps admin edits', async () => {
    const [rule] = await t.db.select().from(farmcalcDosageRule).where(eq(farmcalcDosageRule.inputProductId, ids['Seed Cake']!));
    await saveDosageRule({ ...rule!, amount: 0.5, id: rule!.id }, null);
    expect(await seedDosageRules(ctx())).toMatchObject({ inserted: 0, skipped: 10 });
    const [after] = await t.db.select().from(farmcalcDosageRule).where(eq(farmcalcDosageRule.id, rule!.id));
    expect(Number(after!.amount)).toBe(0.5);
    await saveDosageRule({ ...rule!, amount: 0.25, id: rule!.id }, null);
  });

  it('maps seed rule shapes (pure)', () => {
    const out = rulesFromProduct('00000000-0000-7000-8000-000000000009', '5 L', [{ basis: 'per_plant', size_class: 'L', qty: 1, unit: 'L' }, { basis: 'per_plant', qty: -1 }, { basis: 'per_block', qty: 1 }], 10);
    expect(out.rules).toMatchObject([{ role: 'M', unit: 'L', packSize: 5, position: 10 }]);
    expect(out.notes).toHaveLength(1);
  });
});

describe('rules admin', () => {
  it('one rule per input + basis + role + age; writes are audited', async () => {
    const input = { inputProductId: ids['Charcoal Mix']!, basis: 'per_plant' as const, role: 'M' as const, ageBand: 'at_planting' as const, amount: 3, packSize: 10, isActive: true };
    await expect(saveDosageRule(input, MANAGER.kind === 'staff' ? MANAGER.userId : null)).rejects.toBeInstanceOf(DuplicateRuleError);
    const id = await saveDosageRule({ ...input, ageBand: 'y3_6' }, null);
    const audits = await t.db.select().from(coreAuditLog).where(eq(coreAuditLog.entityId, id));
    expect(audits.map((a) => a.action)).toEqual(['farmcalc.rule.create']);
    expect(await deleteDosageRule(id, null)).toBe(true);
    expect(await deleteDosageRule(id, null)).toBe(false);
  });

  it('actions need products.write; a duplicate is reported, not thrown', async () => {
    signInAs(SUPPORT);
    const form = new FormData();
    form.set('inputProductId', ids['Charcoal Mix']!);
    form.set('role', 'M');
    form.set('amount', '1');
    form.set('packSize', '10');
    expect(await saveRuleAction(form)).toMatchObject({ ok: false, formError: 'forbidden' });
    signInAs(MANAGER);
    expect(await saveRuleAction(form)).toMatchObject({ ok: true, data: { duplicate: true } });
    form.set('amount', '-2');
    expect(await saveRuleAction(form)).toMatchObject({ ok: false, fieldErrors: { amount: expect.any(Array) } });
    expect(await deleteRuleAction({ id: 'nope' })).toMatchObject({ ok: false });
  });

  it('the admin page lists rules by input and needs products.read', async () => {
    signInAs(MANAGER);
    const html = renderToStaticMarkup(await DosageRulesPage({ searchParams: Promise.resolve({ status: 'saved' }) }));
    expect(html).toContain('Dosage rules');
    expect(html).toContain('Worm Compost');
    expect(html).toContain('Rule saved.');
    expect(html).toContain('Add a rule');
    signInAs({ kind: 'guest' });
    await expect(DosageRulesPage({})).rejects.toThrow();
  });
});

describe('recommended inputs API (the dosage contract planting uses)', () => {
  it('returns packs with names and variants for a planting', async () => {
    const out = await recommendedInputs({ plants: [{ qty: 120, role: 'M', compostKg: 5 }, { qty: 300, role: 'X' }, { qty: 185, role: 'O' }], acres: 1 });
    const by = Object.fromEntries(out.map((n) => [n.name, n.packs]));
    expect(by).toEqual({
      'Worm Compost': Math.ceil((120 * 2 + 300 + 185 * 0.5) / 25),
      'Charcoal Mix': Math.ceil((120 + 150 + 185 * 0.25) / 10),
      'Seed Cake': Math.ceil((0.25 * 605) / 25),
      'Liquid Feed': 4,
      'Cover Seed': 10,
      'Farm Compost': Math.ceil((120 * 5 + 300 + 185) / 50),
    });
    expect(out.find((n) => n.name === 'Worm Compost')!.variantId).toBe(variants['Worm Compost']);
  });

  it('cart plants take their role from size class and their own compost kg', async () => {
    const lines = await plantLinesFor([
      { productId: ids['Tall Fruit Tree']!, qty: 4 },
      { productId: ids['Tall Fruit Tree']!, qty: 6 },
      { productId: ids['Bush Plant']!, qty: 20 },
      { productId: ids['Worm Compost']!, qty: 3 },
    ]);
    expect(lines.sort((a, b) => a.qty - b.qty)).toEqual([
      { qty: 10, role: 'M', size: 'L', compostKg: 5 },
      { qty: 20, role: 'O', size: 'S', compostKg: null },
    ]);
    expect(await plantLinesFor([])).toEqual([]);
  });
});

describe('calculator data and pages', () => {
  it('plant list has only plants with a grid spacing, commercial spacing first, with price books', async () => {
    const data = await plantCalculatorData();
    expect(data.plants.map((p) => [p.name, p.spacing])).toEqual([
      ['Bush Plant', [6, 6]],
      ['Tall Fruit Tree', [9, 9]],
    ]);
    expect(Object.keys(data.books)).toEqual([variants['Tall Fruit Tree']]);
  });

  it('GET /api/calculators/plants answers JSON with a public cache header', async () => {
    const res = await GET();
    expect(res.headers.get('cache-control')).toContain('public');
    const body = (await res.json()) as { plants: unknown[] };
    expect(body.plants).toHaveLength(2);
  });

  it('compost data holds active per-plant rules of visible inputs only', async () => {
    const data = await compostCalculatorData();
    expect(new Set(data.rules.map((r) => r.basis))).toEqual(new Set(['per_plant']));
    expect(data.inputs.map((i) => i.name).sort()).toEqual(['Charcoal Mix', 'Farm Compost', 'Seed Cake', 'Worm Compost']);
  });

  it('plant calculator page: heading, metadata and the island with the default 18 x 18 ft result', async () => {
    configureFarmCalculators({ registry: { has: () => false } });
    const html = await renderHtml(await PlantCalculatorPage());
    expect(html).toContain(`<h1`);
    expect(html).toContain(farmCalculatorsMessages.plant.pageTitle);
    expect(html).toContain('Tall Fruit Tree (9 x 9 ft)');
    // 1 acre at 18 x 18 = 134, plus 3% = 139; no cart module, so no add button
    expect(html).toMatch(/data-testid="plant-count"[^>]*>139</);
    expect(html).not.toContain('data-cta="calculator-add-plants"');
    expect(generateMetadata()).toMatchObject({ alternates: { canonical: '/calculators/plants' } });
  });

  it('compost page renders the manual mode without a cart binding and shows packs', async () => {
    configureFarmCalculators({ registry: { has: (id) => id === 'cart' } });
    const html = await renderHtml(await CompostCalculatorPage());
    expect(html).toContain(farmCalculatorsMessages.compost.pageTitle);
    expect(html).toContain('Worm Compost');
    expect(html).toContain('data-cta="calculator-add-compost-pack"');
    expect(html).not.toContain(farmCalculatorsMessages.compost.modeCart);
  });

  it('compost page offers "Plants in my cart" when the cart has plants', async () => {
    configureFarmCalculators({ registry: { has: () => true }, cartLines: async () => [{ productId: ids['Tall Fruit Tree']!, qty: 10 }] });
    const html = await renderHtml(await CompostCalculatorPage());
    expect(html).toContain(farmCalculatorsMessages.compost.modeCart);
    expect(html).toContain('Recommended for 10 plants');
    configureFarmCalculators({});
  });
});

describe('islands (server render of the initial state)', () => {
  const plants = [{ id: 'p1', name: 'Fixture Tree', variantId: 'var-1', spacing: [9, 9] as [number, number] }];
  it('plant calculator shows the picker options and the default count', () => {
    const html = renderToStaticMarkup(<PlantCalculatorIsland plants={plants} books={{}} messages={farmCalculatorsMessages.plant} cartEnabled />);
    expect(html).toContain('Fixture Tree (9 x 9 ft)');
    expect(html).toContain(farmCalculatorsMessages.plant.pickToAdd);
    expect(html).toContain('disabled');
  });

  it('compost calculator defaults to 100 medium trees in manual mode', () => {
    const rules = [{ inputProductId: 'i1', basis: 'per_plant' as const, role: 'X' as const, ageBand: 'at_planting' as const, amount: 1, packSize: 25, unit: 'kg' as const, minPacks: 0, usePlantCompost: false, isActive: true, position: 0 }];
    const html = renderToStaticMarkup(
      <CompostCalculatorIsland rules={rules} inputs={[{ id: 'i1', name: 'Fixture Compost', variantId: null }]} books={{}} cartPlants={null} messages={farmCalculatorsMessages.compost} cartEnabled />,
    );
    expect(html).toContain('Recommended for 100 plants');
    expect(html).toContain('Fixture Compost');
    expect(html).toContain('4 x 25 kg');
  });
});
