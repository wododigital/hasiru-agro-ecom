// Pattern engine: the repeating block of a model as points, per-block counts and scaling to the land.
import type { PlanLayout, PlanPoint } from '@ecomkit/core/contracts';
import { ROLES, SQFT_PER_ACRE, type ModelDef, type Role } from './types';

export interface PlantPick {
  productId: string;
  label: string;
}
export type Picks = Readonly<Record<Role, readonly PlantPick[]>>;

const emptyCounts = (): Record<Role, number> => ({ M: 0, X: 0, O: 0 });

/** FNV-1a over the seed text, then mulberry32: small, fast and identical on server and client. */
export function seededRandom(seed: string | number): () => number {
  let h = 2166136261;
  for (const ch of String(seed)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Exact role counts for `n` cells from shares (largest remainder), so the drawing and the counts agree. */
export function apportion(n: number, mix: Readonly<Record<Role, number>>): Record<Role, number> {
  const total = ROLES.reduce((s, r) => s + mix[r], 0);
  const raw = ROLES.map((r) => ({ r, v: (n * mix[r]) / total }));
  const out = emptyCounts();
  raw.forEach(({ r, v }) => (out[r] = Math.floor(v)));
  let left = n - ROLES.reduce((s, r) => s + out[r], 0);
  for (const { r } of [...raw].sort((a, b) => b.v - Math.floor(b.v) - (a.v - Math.floor(a.v)))) {
    if (left-- <= 0) break;
    out[r] += 1;
  }
  return out;
}

/** Roles on the half-open grid [0, w) x [0, h) of one block, indexed [row][col]. */
function roleGrid(model: ModelDef, seed: string | number): Role[][] {
  const { w, h } = model.blockFt;
  const { plant, row } = model.spacingFt;
  const cols = Math.ceil(w / plant);
  const rows = model.pattern.kind === 'line' || h === 0 ? 1 : Math.ceil(h / row);
  const p = model.pattern;
  if (p.kind === 'random') {
    const counts = apportion(cols * rows, p.mix);
    const cells: Role[] = ROLES.flatMap((r) => Array<Role>(counts[r]).fill(r));
    const rnd = seededRandom(seed);
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [cells[i], cells[j]] = [cells[j]!, cells[i]!];
    }
    return Array.from({ length: rows }, (_, r) => cells.slice(r * cols, (r + 1) * cols));
  }
  return Array.from({ length: rows }, (_, r) => {
    const pattern = p.rows[r % p.rows.length]!;
    return Array.from({ length: cols }, (_, c) => pattern[c % pattern.length] as Role);
  });
}

/**
 * The model's block as points. Edge points (x = w or y = h) are drawn, like the next block's first row and column,
 * but per-block counts use the half-open block [0, w) x [0, h) so they are never counted twice.
 * Species cycle within a role through `picks` (a role without picks keeps its points with an empty product id).
 */
export function blockLayout(model: ModelDef, picks: Picks, options: { seed?: string | number } = {}): Pick<PlanLayout, 'points' | 'perBlock' | 'blockFt' | 'spacingFt'> {
  const { w, h } = model.blockFt;
  const { plant, row } = model.spacingFt;
  const line = model.pattern.kind === 'line' || h === 0;
  const seed = options.seed ?? (model.pattern.kind === 'random' ? (model.pattern.seed ?? 0) : 0);
  const grid = roleGrid(model, seed);
  const nCols = grid[0]?.length ?? 0;
  const nRows = grid.length;
  const maxC = Math.floor(w / plant + 1e-9);
  const maxR = line ? 0 : Math.floor(h / row + 1e-9);
  const cursor = emptyCounts();
  const perBlock = emptyCounts();
  const points: PlanPoint[] = [];
  for (let r = 0; r <= maxR; r++) {
    for (let c = 0; c <= maxC; c++) {
      const x = c * plant;
      const y = r * row;
      const role = grid[r % nRows]![c % nCols]!;
      const inside = x < w && (line || y < h);
      if (inside) perBlock[role] += 1;
      const list = picks[role];
      const pick = list.length ? list[cursor[role]++ % list.length]! : { productId: '', label: '' };
      points.push({ x, y, role, productId: pick.productId, label: pick.label });
    }
  }
  return { points, perBlock, blockFt: { w, h: line ? 0 : h }, spacingFt: { plant, row: line ? 0 : row } };
}

/** 4 x sqrt(area): the perimeter of a square plot, used when the visitor leaves the boundary length empty. */
export const estimateBoundaryFt = (sqft: number): number => Math.round(4 * Math.sqrt(sqft));
export const acresToSqft = (acres: number): number => Math.round(acres * SQFT_PER_ACRE);
export const sqftToAcres = (sqft: number): number => sqft / SQFT_PER_ACRE;

/** Area models: land / block area (1 acre over 36 x 36 ft = 33.6). Line models: boundary / plant spacing. */
export function blocksFor(model: ModelDef, land: { sqft: number; boundaryFt: number | null }): number {
  if (model.pattern.kind === 'line' || model.blockFt.h === 0) return (land.boundaryFt ?? estimateBoundaryFt(land.sqft)) / model.spacingFt.plant;
  return land.sqft / (model.blockFt.w * model.blockFt.h);
}

/**
 * Plants per role for the land. Area: round(perBlock x blocks). Line: round(boundary / spacing) positions,
 * roles taken by cycling the line pattern (835 ft at 10 ft = 84 plants).
 */
export function roleTotals(model: ModelDef, perBlock: Readonly<Record<Role, number>>, land: { sqft: number; boundaryFt: number | null }): Record<Role, number> {
  const blocks = blocksFor(model, land);
  if (model.pattern.kind === 'line' || model.blockFt.h === 0) {
    const n = Math.round(blocks);
    const pattern = model.pattern.kind === 'random' ? 'MXO' : model.pattern.rows[0]!;
    const out = emptyCounts();
    for (let i = 0; i < n; i++) out[pattern[i % pattern.length] as Role] += 1;
    return out;
  }
  const out = emptyCounts();
  for (const r of ROLES) out[r] = Math.round(perBlock[r] * blocks);
  return out;
}

/** Splits a total evenly over n plants; the remainder goes to the first ones. */
export function splitEvenly(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => base + (i < total - base * n ? 1 : 0));
}

/** The full `PlanLayout` contract for one model and land (consumed by the SVG plan, the 3D viewer and the assistant). */
export function planLayout(model: ModelDef, picks: Picks, land: { sqft: number; boundaryFt: number | null }, options: { seed?: string | number } = {}): PlanLayout {
  const block = blockLayout(model, picks, options);
  const totals = roleTotals(model, block.perBlock, land);
  return {
    modelSlug: model.slug,
    modelName: model.name,
    ...block,
    blocks: blocksFor(model, land),
    totalPlants: ROLES.reduce((s, r) => s + (picks[r].length ? totals[r] : 0), 0),
    legend: ROLES.map((role) => ({ role, productIds: picks[role].map((p) => p.productId), perBlock: block.perBlock[role] })),
    boundaryFt: model.pattern.kind === 'line' || model.blockFt.h === 0 ? (land.boundaryFt ?? estimateBoundaryFt(land.sqft)) : null,
  };
}
