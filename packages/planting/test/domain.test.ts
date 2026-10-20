import { describe, expect, it } from 'vitest';
import {
  apportion,
  blockLayout,
  blocksFor,
  choosePicks,
  companionsOf,
  estimateBoundaryFt,
  generateInputSchema,
  membershipsOf,
  patternSchema,
  planLayout,
  recommendModel,
  roleTotals,
  seededRandom,
  splitEvenly,
  SQFT_PER_ACRE,
  toPicks,
  unitAt,
  whatsappShareUrl,
} from '../src/domain';
import { ALL_MODELS, boundary, commercial, foodForest, miyawaki, pid } from './fixtures';

const ACRE = { sqft: SQFT_PER_ACRE, boundaryFt: null };
const noPicks = { M: [], X: [], O: [] };

describe('pattern engine', () => {
  it('Commercial block is 18 plants: M O X O X O along 6 ft, rows 12 ft apart', () => {
    const b = blockLayout(commercial, noPicks);
    expect(b.perBlock).toEqual({ M: 3, X: 6, O: 9 });
    expect(b.perBlock.M + b.perBlock.X + b.perBlock.O).toBe(18);
    const firstRow = b.points.filter((p) => p.y === 0).map((p) => p.role).join('');
    expect(firstRow).toBe('MOXOXOM');
  });

  it('counts edges half-open: edge points are drawn but never counted twice', () => {
    const b = blockLayout(commercial, noPicks);
    expect(b.points).toHaveLength(7 * 4); // x 0..36 by 6, y 0..36 by 12
    const inside = b.points.filter((p) => p.x < 36 && p.y < 36);
    expect(inside).toHaveLength(18);
    const onEdge = b.points.filter((p) => p.x === 36 || p.y === 36);
    expect(onEdge).toHaveLength(10);
    // A 2 x 2 tiling of blocks has exactly 4 x 18 plants: no edge plant is shared.
    expect(4 * (b.perBlock.M + b.perBlock.X + b.perBlock.O)).toBe(72);
  });

  it('Food Forest alternates its two row strings', () => {
    const b = blockLayout(foodForest, noPicks);
    expect(b.points.filter((p) => p.y === 0 && p.x < 36).map((p) => p.role).join('')).toBe('MOXOMO');
    expect(b.points.filter((p) => p.y === 6 && p.x < 36).map((p) => p.role).join('')).toBe('OXOXOX');
    expect(b.perBlock.M + b.perBlock.X + b.perBlock.O).toBe(36);
  });

  it('Miyawaki places exact shares with a seeded shuffle: same seed same drawing, new seed new drawing', () => {
    const a = blockLayout(miyawaki, noPicks, { seed: 'plan-a' });
    const again = blockLayout(miyawaki, noPicks, { seed: 'plan-a' });
    const other = blockLayout(miyawaki, noPicks, { seed: 'plan-b' });
    expect(a.perBlock).toEqual({ M: 32, X: 162, O: 130 });
    expect(other.perBlock).toEqual(a.perBlock);
    expect(again.points).toEqual(a.points);
    expect(other.points.map((p) => p.role)).not.toEqual(a.points.map((p) => p.role));
    expect(apportion(10, { M: 1, X: 1, O: 1 })).toEqual({ M: 4, X: 3, O: 3 });
  });

  it('seeded random is deterministic and in [0, 1)', () => {
    const r1 = seededRandom(42);
    const r2 = seededRandom(42);
    const xs = Array.from({ length: 100 }, () => r1());
    expect(Array.from({ length: 100 }, () => r2())).toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('Boundary is a single line: points along x only', () => {
    const b = blockLayout(boundary, noPicks);
    expect(b.points.every((p) => p.y === 0)).toBe(true);
    expect(b.points.map((p) => p.role).join('')).toBe('MOXO');
    expect(b.blockFt).toEqual({ w: 36, h: 0 });
  });

  it('species cycle within a role through the picks', () => {
    const picks = toPicks(choosePicks(commercial.members, {}, 3).picks, (id) => `p${id.slice(-2)}`);
    const b = blockLayout(commercial, picks);
    const os = b.points.filter((p) => p.role === 'O').map((p) => p.productId);
    expect(os.slice(0, 3)).toEqual([pid(5), pid(6), pid(7)]);
    expect(os[3]).toBe(pid(5));
  });
});

describe('scaling', () => {
  it('1 acre is 33.6 blocks of 36 x 36 ft', () => {
    expect(blocksFor(commercial, ACRE)).toBeCloseTo(33.61, 2);
    expect(Number(blocksFor(commercial, ACRE).toFixed(1))).toBe(33.6);
  });

  it('role totals are round(perBlock x blocks)', () => {
    const t = roleTotals(commercial, { M: 3, X: 6, O: 9 }, ACRE);
    expect(t).toEqual({ M: 101, X: 202, O: 303 });
  });

  it('Boundary fixture: 835 ft at 10 ft spacing is 84 plants', () => {
    const land = { sqft: SQFT_PER_ACRE, boundaryFt: 835 };
    const t = roleTotals(boundary, { M: 1, X: 1, O: 2 }, land);
    expect(t.M + t.X + t.O).toBe(84);
    expect(t).toEqual({ M: 21, X: 21, O: 42 });
    expect(recommendModel(boundary, {}, land, { perRole: 3 }).totalPlants).toBe(84);
  });

  it('without a boundary length the Boundary model estimates 4 x sqrt(area)', () => {
    expect(estimateBoundaryFt(SQFT_PER_ACRE)).toBe(835);
    expect(planLayout(boundary, toPicks(choosePicks(boundary.members, {}, 3).picks), ACRE).boundaryFt).toBe(835);
  });

  it('splits a role evenly, remainder to the first plants', () => {
    expect(splitEvenly(10, 3)).toEqual([4, 3, 3]);
    expect(splitEvenly(11, 3)).toEqual([4, 4, 3]);
    expect(splitEvenly(2, 3)).toEqual([1, 1, 0]);
    expect(splitEvenly(5, 0)).toEqual([]);
  });

  it('recommendation splits each role over its picks and sums to the role total', () => {
    const r = recommendModel(commercial, {}, ACRE, { perRole: 3 });
    const byRole = (role: string) => r.lines.filter((l) => l.role === role);
    expect(byRole('M').map((l) => l.qty)).toEqual([51, 50]);
    expect(byRole('X').map((l) => l.qty)).toEqual([101, 101]);
    expect(byRole('O').map((l) => l.qty)).toEqual([101, 101, 101]);
    expect(r.totalPlants).toBe(606);
    expect(r.emptyRoles).toEqual([]);
  });

  it('location changes the plant set: a not-recommended plant drops out and its role is re-split', () => {
    const everywhere = recommendModel(commercial, {}, ACRE, { perRole: 3 });
    const dry = recommendModel(commercial, { [pid(2)]: 'not_recommended', [pid(6)]: 'not_recommended' }, ACRE, { perRole: 3 });
    expect(everywhere.lines.map((l) => l.productId)).toContain(pid(2));
    expect(dry.lines.map((l) => l.productId)).not.toContain(pid(2));
    expect(dry.lines.filter((l) => l.role === 'M')).toEqual([{ productId: pid(1), role: 'M', qty: 101 }]);
    expect(dry.totalPlants).toBe(everywhere.totalPlants);
  });

  it('a role with no fitting plant is reported empty, not filled', () => {
    const r = recommendModel(foodForest, { [pid(1)]: 'not_recommended' }, ACRE, { perRole: 3 });
    expect(r.emptyRoles).toEqual(['M']);
    expect(r.lines.some((l) => l.role === 'M')).toBe(false);
  });

  it('picks: default picks first, then better fit; the rest are alternates', () => {
    const members = commercial.members.map((m) => (m.productId === pid(7) ? { ...m, isDefaultPick: true } : m));
    const { picks, alternates } = choosePicks(members, { [pid(6)]: 'good', [pid(5)]: 'ok' }, 2);
    expect(picks.O.map((m) => m.productId)).toEqual([pid(7), pid(6)]);
    expect(alternates.O.map((m) => m.productId)).toEqual([pid(5)]);
  });

  it('the PlanLayout contract is complete for every model', () => {
    for (const model of ALL_MODELS) {
      const l = planLayout(model, toPicks(choosePicks(model.members, {}, 3).picks), { sqft: SQFT_PER_ACRE, boundaryFt: 835 }, { seed: 'x' });
      expect(l.modelSlug).toBe(model.slug);
      expect(l.legend.map((x) => x.role)).toEqual(['M', 'X', 'O']);
      expect(l.totalPlants).toBeGreaterThan(0);
      expect(l.points.every((p) => p.productId)).toBe(true);
    }
  });
});

describe('prices, companions, share, schemas', () => {
  it('unit price follows the tier once qty reaches it', () => {
    const quote = { listUnitPaise: 49_000, tier: null, nextTier: { minQty: 50, unitPaise: 35_500 } };
    expect(unitAt(quote, 49)).toEqual({ unitPaise: 49_000, bulk: false });
    expect(unitAt(quote, 50)).toEqual({ unitPaise: 35_500, bulk: true });
    expect(unitAt({ listUnitPaise: 49_000, tier: { minQty: 50, unitPaise: 35_500 }, nextTier: null }, 10)).toEqual({ unitPaise: 49_000, bulk: false });
  });

  it('companions: co-members in a different role rank first, nitrogen fixers get a bonus', () => {
    const ms = membershipsOf(ALL_MODELS);
    const c = companionsOf(pid(1), ms, new Set([pid(7)]));
    expect(c).not.toContain(pid(1));
    expect(c).not.toContain(pid(2)); // same role (M) in every shared model
    expect(c[0]).toBe(pid(3)); // shares four models with pid(1) in another role
    expect(c).toContain(pid(7));
    expect(companionsOf(pid(99), ms, new Set())).toEqual([]);
  });

  it('share url carries the text and the link', () => {
    expect(whatsappShareUrl('My plan', 'https://example.test/plan/results/1')).toBe('https://wa.me/?text=My%20plan%20https%3A%2F%2Fexample.test%2Fplan%2Fresults%2F1');
  });

  it('validates wizard input and patterns at the boundary', () => {
    expect(generateInputSchema.safeParse({ district: 'mysuru', sqft: '43560', purpose: 'commercial' }).success).toBe(true);
    expect(generateInputSchema.safeParse({ district: 'mysuru', sqft: 100, purpose: 'commercial' }).success).toBe(false); // under 0.1 acre
    expect(generateInputSchema.safeParse({ district: 'Mysuru!', sqft: 43560, purpose: 'commercial' }).success).toBe(false);
    expect(generateInputSchema.parse({ district: 'a', sqft: 43560, purpose: 'boundary', boundaryFt: '' }).boundaryFt).toBeUndefined();
    expect(patternSchema.safeParse({ kind: 'rows', rows: ['MOXQ'] }).success).toBe(false);
    expect(patternSchema.safeParse({ kind: 'random', mix: { M: 0, X: 0, O: 0 }, seed: null }).success).toBe(false);
  });
});
