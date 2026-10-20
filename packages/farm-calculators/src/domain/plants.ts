// Plant calculator maths (A10). Pure: shared by the server page, the client island and the tests.
import { z } from 'zod';

export const SQFT_PER_ACRE = 43_560;
/** A triangular (staggered) layout fits about 15.5% more plants than a square grid at the same spacing. */
export const TRIANGULAR_FACTOR = 1.155;
/** Gap-filling extra, in percent. */
export const BUFFER_PCT = 3;

export const AREA_UNITS = ['acre', 'sqft'] as const;
export type AreaUnit = (typeof AREA_UNITS)[number];
export const LAYOUTS = ['square', 'triangular'] as const;
export type Layout = (typeof LAYOUTS)[number];

export const DEFAULT_SPACING_FT = 18;
export const MAX_SPACING_FT = 200;
/** 100,000 acres: far above any farm, low enough that counts stay safe integers. */
export const MAX_AREA_SQFT = 100_000 * SQFT_PER_ACRE;

export function toSqft(value: number, unit: AreaUnit): number {
  return unit === 'acre' ? value * SQFT_PER_ACRE : value;
}

/** Converting the field when the unit toggles: sq ft as a whole number, acres to two decimals (prototype C2.9). */
export function convertArea(value: number, from: AreaUnit, to: AreaUnit): number {
  if (from === to) return value;
  return to === 'sqft' ? Math.round(value * SQFT_PER_ACRE) : Math.round((value / SQFT_PER_ACRE) * 100) / 100;
}

export const plantCalcInputSchema = z.object({
  area: z.coerce.number().min(0).catch(0),
  unit: z.enum(AREA_UNITS).catch('acre'),
  lengthFt: z.coerce.number().min(1).max(MAX_SPACING_FT).catch(DEFAULT_SPACING_FT),
  widthFt: z.coerce.number().min(1).max(MAX_SPACING_FT).catch(DEFAULT_SPACING_FT),
  layout: z.enum(LAYOUTS).catch('square'),
  buffer: z.boolean().catch(true),
});
export type PlantCalcInput = z.output<typeof plantCalcInputSchema>;

export interface PlantCount {
  /** Plants that fit: round(sqft / (L x W) x layout factor). */
  base: number;
  /** base plus the gap-filling buffer when on: ceil(base x 1.03). */
  total: number;
  perAcre: number;
  sqft: number;
}

/**
 * A10: base `Math.round(sqft / (L x W) x (tri ? 1.155 : 1))`, buffer `Math.ceil(n x 1.03)`.
 * 1 acre at 9 x 9 ft = 538, at 10 x 10 ft = 436 (SRS acceptance cases). The buffer is integer maths so
 * 100 plants become 103, not 104 through 100 x 1.03 = 103.00000000000001.
 */
export function plantCount(input: PlantCalcInput): PlantCount {
  const sqft = Math.min(toSqft(input.area, input.unit), MAX_AREA_SQFT);
  const factor = input.layout === 'triangular' ? TRIANGULAR_FACTOR : 1;
  const cell = input.lengthFt * input.widthFt;
  const base = Math.round((sqft / cell) * factor);
  const total = input.buffer ? Math.ceil((base * (100 + BUFFER_PCT)) / 100) : base;
  return { base, total, perAcre: Math.round((SQFT_PER_ACRE / cell) * factor), sqft };
}

/**
 * The spacing a plant suggests, from its per-model spacing map: the first area model (two numbers) in `prefer`
 * order, else any area model. Line models (one number) do not fit a grid calculator.
 */
export function suggestedSpacing(spacingFt: Readonly<Record<string, unknown>> | null | undefined, prefer: readonly string[] = []): [number, number] | null {
  if (!spacingFt) return null;
  const tuple = (v: unknown): [number, number] | null =>
    Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && n > 0 && n <= MAX_SPACING_FT) ? [v[0] as number, v[1] as number] : null;
  for (const key of prefer) {
    const t = tuple(spacingFt[key]);
    if (t) return t;
  }
  for (const v of Object.values(spacingFt)) {
    const t = tuple(v);
    if (t) return t;
  }
  return null;
}

/** A plant the calculator offers (visible, with a grid spacing). */
export interface CalcPlant {
  id: string;
  name: string;
  variantId: string | null;
  spacing: [number, number];
}
