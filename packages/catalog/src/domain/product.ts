import { z } from 'zod';
import * as E from './enums';

// Admin forms post strings; import files carry numbers or blanks. These coercers accept both and map blanks to null.
const blank = (v: unknown) => (v === '' || v === undefined ? null : v);
const str = (max = 2000) => z.preprocess((v) => (typeof v === 'string' ? blank(v.trim()) : blank(v)), z.string().max(max).nullable());
const num = z.preprocess((v) => {
  const b = typeof v === 'string' ? blank(v.trim()) : blank(v);
  return b === null ? null : Number(b);
}, z.number().finite().nullable());
const int = z.preprocess((v) => {
  const b = typeof v === 'string' ? blank(v.trim()) : blank(v);
  return b === null ? null : Number(b);
}, z.number().int().nullable());
const bool = z.preprocess((v) => v === true || (typeof v === 'string' && ['true', 'on', '1', 'yes'].includes(v.trim().toLowerCase())), z.boolean());
const list = z.preprocess(
  (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\n]/) : []),
  z.array(z.string().trim().max(200)).transform((a) => [...new Set(a.filter(Boolean))]),
);
const enumOrNull = <T extends readonly [string, ...string[]]>(values: T) => z.preprocess(blank, z.enum(values).nullable());

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const spacingValue = z.union([z.tuple([z.number().positive(), z.number().positive()]), z.number().positive(), z.null()]);
const compost = z
  .object({ at_planting: z.number().nullable(), y0_2: z.number().nullable(), y3_6: z.number().nullable(), y7_plus: z.number().nullable() })
  .nullable();

/** Every editable product field: the admin form, the CSV/XLSX import and the seed import all validate through this. */
export const productFieldsSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  kind: z.enum(E.KINDS),
  slug: z.string().trim().toLowerCase().regex(SLUG_PATTERN).max(120),
  name: z.string().trim().min(1).max(200),
  nameKn: str(200),
  scientificName: str(200),
  baseName: str(200),
  variety: str(200),
  collectionId: z.preprocess(blank, z.uuid().nullable()),
  subcategory: str(120),
  sizeClass: enumOrNull(E.SIZE_CLASSES),
  canopy: enumOrNull(E.CANOPIES),
  propagation: enumOrNull(E.PROPAGATIONS),
  nitrogenFixer: bool,
  droughtTolerance: enumOrNull(E.LEVELS),
  waterNeed: enumOrNull(E.WATER_NEEDS),
  exposure: enumOrNull(E.EXPOSURES),
  tempMin: num,
  tempOpt: num,
  tempMax: num,
  humidityMin: num,
  humidityOpt: num,
  humidityMax: num,
  rainfallMin: int,
  rainfallMax: int,
  soilTags: list,
  matureHeightMinFt: num,
  matureHeightMaxFt: num,
  bearingYearsMin: num,
  bearingYearsMax: num,
  timberRotationYears: num,
  yieldText: str(200),
  harvestSeason: str(200),
  attributes: z.record(z.string(), z.string().nullable()).default({}),
  // Stored without null entries (a model the plant is not in has no key), so imports compare stably.
  spacingFt: z
    .record(z.string(), spacingValue)
    .default({})
    .transform((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v != null))),
  compostKg: compost.default(null).transform((c) => (c && Object.values(c).some((v) => v != null) ? c : null)),
  inputType: str(40),
  packSize: str(40),
  dosageRules: z.array(z.unknown()).nullable().default(null),
  shortDescription: str(1000),
  descriptionHtml: str(50_000),
  careHtml: str(50_000),
  status: z.enum(E.STATUSES).default('draft'),
  availabilityOverride: enumOrNull(E.AVAILABILITY_OVERRIDES),
  isFeatured: bool,
  isBestSeller: bool,
  weightKg: num,
  packingFeePaise: int,
  hsn: str(16),
  gstRate: num,
  taxClass: str(40),
  bagSize: str(60),
  heightAtDispatchFt: num,
  seoTitle: str(120),
  seoDescription: str(320),
  focusKeyword: str(120),
  noindex: bool,
  searchAliases: list,
  needsReview: bool,
  reviewNotes: list,
  imageNeeded: bool,
  legacySku: str(64),
  legacyWooId: int,
  erpItemId: str(64),
  dataSource: z.record(z.string(), z.string().nullable()).default({}),
});
export type ProductFields = z.infer<typeof productFieldsSchema>;
export type ProductFieldsInput = z.input<typeof productFieldsSchema>;

export const variantFieldsSchema = z.object({
  id: z.preprocess(blank, z.uuid().nullable()).default(null),
  label: z.string().trim().min(1).max(120),
  skuSuffix: z.string().trim().max(16),
  isDefault: bool,
  heightFt: num,
  bagSize: str(60),
  weightKg: num,
  position: z.coerce.number().int().default(0),
});
export type VariantFields = z.infer<typeof variantFieldsSchema>;

/** Exactly one default per product: the flagged one, else the first. */
export function normaliseVariants(variants: readonly VariantFields[]): VariantFields[] {
  if (!variants.length) return [];
  const def = Math.max(0, variants.findIndex((v) => v.isDefault));
  return variants.map((v, i) => ({ ...v, isDefault: i === def, position: i, skuSuffix: v.skuSuffix || `-${String(i + 1).padStart(2, '0')}` }));
}

/** "3-4", "3 to 4", "5", "5+" -> numbers; anything else -> nulls. */
export function parseRange(text: string | null | undefined): { min: number | null; max: number | null } {
  const nums = (text ?? '').match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (!nums.length) return { min: null, max: null };
  return { min: Math.min(...nums.slice(0, 2)), max: Math.max(...nums.slice(0, 2)) };
}
