// Pure viewer maths: patch from a PlanLayout, plant archetypes, sun, walking, view choice. No React, Next or three.
import type { PlanLayout, Role } from '@ecomkit/core/contracts';

/** Standard display forms; sizes are illustrations per plant type, not measurements of a given plant. */
export const ARCHETYPES = ['large_fruit', 'small_fruit', 'timber', 'shrub', 'banana'] as const;
export type Archetype = (typeof ARCHETYPES)[number];

/** Canopy radius in ft for the 2D plan, matching the 3D trees (prototype C4a.7). */
export const CANOPY_RADIUS_FT: Record<Archetype, number> = { large_fruit: 5.2, small_fruit: 3.4, timber: 3.3, shrub: 2.3, banana: 3.5 };

/** What the catalogue knows about a plant that decides how it is drawn. */
export interface PlantHint {
  name: string;
  /** Catalogue canopy class (large_tree, medium_tree, small_tree, shrub, climber). */
  canopy?: string | null;
  /** Catalogue group: timber, fruiting or other. */
  group?: 'timber' | 'fruit' | 'other' | null;
  /** Explicit override. */
  archetype?: Archetype | null;
}

const BANANA = /\b(banana|plantain)\b/i;

/** Hint first, then canopy and group, then the role (M main crop, X host tree, O biomass). */
export function archetypeFor(hint: PlantHint | undefined, role: Role): Archetype {
  if (hint?.archetype) return hint.archetype;
  if (hint && BANANA.test(hint.name)) return 'banana';
  if (hint?.group === 'timber') return 'timber';
  switch (hint?.canopy) {
    case 'shrub':
    case 'climber':
      return 'shrub';
    case 'small_tree':
      return 'small_fruit';
    case 'large_tree':
    case 'medium_tree':
      return hint.group === 'fruit' || role === 'M' ? 'large_fruit' : 'timber';
  }
  return role === 'M' ? 'large_fruit' : role === 'X' ? 'timber' : 'shrub';
}

/** How many plant positions the 3D patch shows along and across the rows, and the display scale. */
export interface PatchSpec {
  nx: number;
  ny: number;
  scale: number;
}
export const FALLBACK_PATCH: PatchSpec = { nx: 7, ny: 7, scale: 1 };
/** Per model slug (hyphens and underscores are the same). Dense plantings show young saplings (scale below 1). */
export const DEFAULT_PATCHES: Readonly<Record<string, PatchSpec>> = {
  commercial: { nx: 13, ny: 3, scale: 1 },
  food_forest: { nx: 7, ny: 7, scale: 1 },
  miyawaki: { nx: 7, ny: 7, scale: 0.45 },
  boundary: { nx: 15, ny: 1, scale: 1 },
};
export const modelKey = (slug: string) => slug.trim().toLowerCase().replace(/-/g, '_');
export function patchSpecFor(slug: string, overrides: Readonly<Record<string, PatchSpec>> = {}): PatchSpec {
  const k = modelKey(slug);
  return overrides[k] ?? DEFAULT_PATCHES[k] ?? FALLBACK_PATCH;
}

export interface PatchPoint {
  x: number;
  z: number;
  role: Role;
  productId: string;
  name: string;
  archetype: Archetype;
}

/** Everything the viewer island renders. Plain data, so a server component can pass it as props. */
export interface ViewerData {
  modelSlug: string;
  modelName: string;
  spacing: { plant: number; row: number };
  /** Patch size in ft (half-open: positions run 0 .. w - spacing). */
  extent: { w: number; d: number };
  scale: number;
  /** Raised beds with drip lines when rows are 10 ft or more apart. */
  raised: boolean;
  points: PatchPoint[];
  legend: { role: Role; names: string[] }[];
  /** Times a patch like this repeats across the visitor's land, when the land is known. */
  repeats: number | null;
}

const safe = (n: number, fallback: number) => (Number.isFinite(n) && n > 0 ? n : fallback);

/**
 * The patch: `nx` plant positions along the row by `ny` rows, at the layout's spacing. Each position takes the block
 * plant at the same place in the block's own grid (column and row index modulo the block's), so row patterns keep
 * cycling, a seeded mix repeats, and a single boundary line stays one row, even when the spacing does not divide
 * the block size.
 */
export function patchPoints(layout: PlanLayout, spec: PatchSpec, hints: Readonly<Record<string, PlantHint>> = {}): { points: PatchPoint[]; extent: { w: number; d: number } } {
  const plant = safe(layout.spacingFt.plant, 1);
  const row = safe(layout.spacingFt.row, plant);
  const grid = new Map<string, PlanLayout['points'][number]>();
  let cols = 0;
  let rows = 0;
  for (const p of layout.points) {
    const c = Math.round(p.x / plant);
    const r = Math.round(p.y / row);
    if (c < 0 || r < 0) continue;
    if (!grid.has(`${c},${r}`)) grid.set(`${c},${r}`, p);
    cols = Math.max(cols, c + 1);
    rows = Math.max(rows, r + 1);
  }
  const points: PatchPoint[] = [];
  for (let r = 0; r < spec.ny && rows; r++) {
    for (let c = 0; c < spec.nx; c++) {
      const p = grid.get(`${c % cols},${r % rows}`);
      if (p) points.push({ x: c * plant, z: r * row, role: p.role, productId: p.productId, name: hints[p.productId]?.name ?? p.label, archetype: archetypeFor(hints[p.productId], p.role) });
    }
  }
  return { points, extent: { w: spec.nx * plant, d: spec.ny * row } };
}

export function patchRepeats(landSqft: number | null | undefined, extent: { w: number; d: number }): number | null {
  if (!landSqft || !(landSqft > 0)) return null;
  return Math.max(1, Math.round(landSqft / (extent.w * extent.d)));
}

export interface ViewerSource {
  layout: PlanLayout;
  hints?: Readonly<Record<string, PlantHint>>;
  /** The visitor's land, for the "repeats about N times" caption. */
  landSqft?: number | null;
}

export function buildViewerData(source: ViewerSource, spec: PatchSpec): ViewerData {
  const { layout } = source;
  const hints = source.hints ?? {};
  const { points, extent } = patchPoints(layout, spec, hints);
  const legend = (['M', 'X', 'O'] as const).flatMap((role) => {
    const fromLegend = layout.legend.find((l) => l.role === role)?.productIds ?? [];
    const ids = fromLegend.length ? fromLegend : [...new Set(points.filter((p) => p.role === role).map((p) => p.productId))];
    const names = [...new Set(ids.map((id) => hints[id]?.name ?? layout.points.find((p) => p.productId === id)?.label ?? ''))].filter(Boolean);
    return names.length ? [{ role, names }] : [];
  });
  const row = safe(layout.spacingFt.row, safe(layout.spacingFt.plant, 1));
  return {
    modelSlug: layout.modelSlug,
    modelName: layout.modelName,
    spacing: { plant: safe(layout.spacingFt.plant, 1), row },
    extent,
    scale: spec.scale,
    raised: row >= 10 && spec.ny > 1,
    points,
    legend,
    repeats: patchRepeats(source.landSqft, extent),
  };
}

/** 2D plan by default when the visitor prefers reduced motion or the device is low on memory. */
export function prefers2d(env: { reducedMotion: boolean; deviceMemory?: number | undefined }): boolean {
  return env.reducedMotion || (env.deviceMemory !== undefined && env.deviceMemory < 4);
}

/**
 * Sun position for the slider (0 = low morning sun, 100 = high noon): elevation 12 to 78 degrees, azimuth sweeping
 * east to south, warmer and dimmer near the horizon.
 */
export function sunLight(value: number): { elevation: number; azimuth: number; warmth: number; intensity: number } {
  const v = Math.min(100, Math.max(0, value));
  return {
    elevation: ((12 + v * 0.66) * Math.PI) / 180,
    azimuth: -0.9 + v * 0.012,
    warmth: 1 - Math.min(1, v / 55),
    intensity: 1.1 + Math.min(1, v / 40) * 0.5,
  };
}

export const WALK_SPEED_FT_S = 8;
export const TURN_RAD_S = 1.6;
export const EYE_HEIGHT_FT = 5.5;

export interface WalkState {
  x: number;
  z: number;
  yaw: number;
}
/** forward/strafe/turn in -1..1 (keys or thumbstick). Movement is relative to where the walker faces, clamped to bounds. */
export function walkStep(s: WalkState, input: { forward: number; strafe: number; turn: number }, dt: number, bounds: { minX: number; maxX: number; minZ: number; maxZ: number }): WalkState {
  const t = Math.min(0.05, Math.max(0, dt));
  const yaw = s.yaw + input.turn * TURN_RAD_S * t;
  const step = WALK_SPEED_FT_S * t;
  const sn = Math.sin(yaw);
  const cs = Math.cos(yaw);
  const x = s.x + (-sn * input.forward + cs * input.strafe) * step;
  const z = s.z + (-cs * input.forward - sn * input.strafe) * step;
  return { yaw, x: Math.min(bounds.maxX, Math.max(bounds.minX, x)), z: Math.min(bounds.maxZ, Math.max(bounds.minZ, z)) };
}

/** Thumbstick drag to -1..1 on each axis, clipped to the stick's radius. */
export function stickVector(dx: number, dy: number, radius: number): { x: number; y: number } {
  const d = Math.hypot(dx, dy);
  const k = d > radius ? radius / d : 1;
  return { x: (dx * k) / radius, y: (dy * k) / radius };
}

/** A round scale-bar length (ft) for the 2D plan. */
export function scaleBarFt(spanFt: number): number {
  return spanFt >= 60 ? 20 : spanFt >= 24 ? 10 : 5;
}
