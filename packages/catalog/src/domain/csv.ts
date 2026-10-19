import type { ProductFields } from './product';

type FlatField = Exclude<keyof ProductFields, 'attributes' | 'spacingFt' | 'compostKg' | 'dosageRules' | 'dataSource' | 'collectionId'>;

/** Flat CSV export and import: one row per product, snake_case headers, lists joined with "|". */
export const CSV_COLUMNS: readonly (readonly [header: string, field: FlatField])[] = [
  ['sku', 'sku'],
  ['kind', 'kind'],
  ['slug', 'slug'],
  ['name', 'name'],
  ['name_kn', 'nameKn'],
  ['scientific_name', 'scientificName'],
  ['base_name', 'baseName'],
  ['variety', 'variety'],
  ['subcategory', 'subcategory'],
  ['status', 'status'],
  ['availability_override', 'availabilityOverride'],
  ['size_class', 'sizeClass'],
  ['canopy', 'canopy'],
  ['propagation', 'propagation'],
  ['nitrogen_fixer', 'nitrogenFixer'],
  ['drought_tolerance', 'droughtTolerance'],
  ['water_need', 'waterNeed'],
  ['exposure', 'exposure'],
  ['temp_min', 'tempMin'],
  ['temp_opt', 'tempOpt'],
  ['temp_max', 'tempMax'],
  ['humidity_min', 'humidityMin'],
  ['humidity_opt', 'humidityOpt'],
  ['humidity_max', 'humidityMax'],
  ['rainfall_min', 'rainfallMin'],
  ['rainfall_max', 'rainfallMax'],
  ['soil_tags', 'soilTags'],
  ['mature_height_min_ft', 'matureHeightMinFt'],
  ['mature_height_max_ft', 'matureHeightMaxFt'],
  ['bearing_years_min', 'bearingYearsMin'],
  ['bearing_years_max', 'bearingYearsMax'],
  ['timber_rotation_years', 'timberRotationYears'],
  ['yield', 'yieldText'],
  ['harvest_season', 'harvestSeason'],
  ['input_type', 'inputType'],
  ['pack_size', 'packSize'],
  ['short_description', 'shortDescription'],
  ['description_html', 'descriptionHtml'],
  ['care_html', 'careHtml'],
  ['is_featured', 'isFeatured'],
  ['is_best_seller', 'isBestSeller'],
  ['weight_kg', 'weightKg'],
  ['packing_fee_paise', 'packingFeePaise'],
  ['hsn', 'hsn'],
  ['gst_rate', 'gstRate'],
  ['tax_class', 'taxClass'],
  ['bag_size', 'bagSize'],
  ['height_at_dispatch_ft', 'heightAtDispatchFt'],
  ['seo_title', 'seoTitle'],
  ['seo_description', 'seoDescription'],
  ['focus_keyword', 'focusKeyword'],
  ['noindex', 'noindex'],
  ['search_aliases', 'searchAliases'],
  ['needs_review', 'needsReview'],
  ['review_notes', 'reviewNotes'],
  ['image_needed', 'imageNeeded'],
  ['legacy_sku', 'legacySku'],
  ['legacy_woo_id', 'legacyWooId'],
  ['erp_item_id', 'erpItemId'],
];

/** Store-export headers from the previous platform that map onto content fields (matched by legacy sku). */
export const LEGACY_CSV_ALIASES: Readonly<Record<string, FlatField>> = {
  SKU: 'legacySku',
  Name: 'name',
  'Short description': 'shortDescription',
  Description: 'descriptionHtml',
};

const LIST_FIELDS = new Set<FlatField>(['soilTags', 'searchAliases', 'reviewNotes']);

export function toCsvCell(field: FlatField, value: unknown): string | number | boolean | null {
  if (LIST_FIELDS.has(field)) return Array.isArray(value) ? value.join('|') : null;
  return (value ?? null) as string | number | boolean | null;
}

/** A parsed CSV row (header -> cell) to product field input; lists split on "|". Unknown headers are ignored. */
export function fromCsvRow(row: Readonly<Record<string, unknown>>): Partial<Record<FlatField, unknown>> {
  const out: Partial<Record<FlatField, unknown>> = {};
  for (const [header, field] of CSV_COLUMNS) {
    if (!(header in row)) continue;
    const v = row[header];
    out[field] = LIST_FIELDS.has(field) ? String(v ?? '').split('|').map((s) => s.trim()).filter(Boolean) : typeof v === 'string' ? v : v == null ? '' : String(v);
  }
  for (const [header, field] of Object.entries(LEGACY_CSV_ALIASES)) {
    if (header in row && !(field in out)) out[field] = row[header] == null ? '' : String(row[header]);
  }
  return out;
}
