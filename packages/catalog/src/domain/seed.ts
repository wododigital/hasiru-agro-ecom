import { z } from 'zod';
import { parseRange, productFieldsSchema, type ProductFields, type VariantFields } from './product';
import type { FaqStatus, MediaRole, TagKind } from './enums';

// data/seed/products.json and inputs.json records (data/seed/SCHEMA.md + research product-data section 12).
// Unknown keys are ignored so the pipeline can add fields without breaking the importer.
const n = z.number().nullable().optional();
const s = z.string().nullable().optional();

const seedVariant = z.object({
  label: z.string(),
  sku: z.string().optional(),
  height_at_dispatch_ft: n,
  bag_size: s,
  weight_kg: n,
});

const spacing = z.object({ spacing_ft: z.union([z.tuple([z.number(), z.number()]), z.number()]).nullable().optional() }).nullable().optional();

export const seedProductSchema = z.object({
  sku: z.string().min(1),
  legacy_sku: s,
  legacy_woo_id: z.number().int().nullable().optional(),
  ops_item_id: s,
  status: z.enum(['draft', 'active', 'archived']),
  kind: z.enum(['plant', 'input']),
  name_en: z.string().min(1),
  base_name: s,
  variety: s,
  name_kn: s,
  scientific_name: s,
  search_aliases: z.array(z.string()).default([]),
  slug: z.string().min(1),
  collection: z.string().min(1),
  subcategory: s,
  tags: z.array(z.string()).default([]),
  is_best_seller: z.boolean().default(false),
  is_featured: z.boolean().default(false),
  /** When the product was first listed; omitted = part of the opening catalogue (never shown as "New"). */
  published_at: z.iso.datetime({ offset: true }).nullable().optional(),
  plant: z
    .object({
      size_class: z.enum(['L', 'M', 'S']).nullable().optional(),
      canopy: s,
      propagation: s,
      nitrogen_fixer: z.boolean().default(false),
      drought_tolerance: s,
      climate: z
        .object({
          temp_c: z.object({ opt: n, min: n, max: n }).nullable().optional(),
          humidity_pct: z.object({ opt: n, min: n, max: n }).nullable().optional(),
          rainfall_mm: z.object({ min: n, max: n }).nullable().optional(),
          exposure: s,
          water_need: s,
          soil_tags: z.array(z.string()).default([]),
        })
        .nullable()
        .optional(),
      models: z.record(z.string(), spacing).default({}),
      compost_kg: z.object({ at_planting: n, y0_2: n, y3_6: n, y7_plus: n }).nullable().optional(),
      attributes: z
        .object({
          mature_height_ft: z.object({ min: n, max: n }).nullable().optional(),
          bearing_years: s,
          timber_rotation_years: s,
          yield_per_tree: s,
          harvest_season: s,
          fruit_size: s,
          fruit_shape: s,
          intercropping: s,
        })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
  input: z
    .object({ pack_size: z.union([z.number(), z.string()]).nullable().optional(), unit: s, dosage_rules: z.array(z.unknown()).nullable().optional() })
    .nullable()
    .optional(),
  variants: z.array(seedVariant).min(1),
  tax: z.object({ hsn: s, gst_rate: n, tax_class: s }).nullable().optional(),
  content: z
    .object({
      short_description: s,
      description_html: s,
      faqs: z.array(z.object({ q: z.string(), a: s, source: s, status: s })).default([]),
    })
    .nullable()
    .optional(),
  media: z
    .object({
      images: z.array(z.object({ src: z.string(), alt: s, role: s })).default([]),
      image_needed: z.boolean().default(false),
    })
    .nullable()
    .optional(),
  seo: z.object({ title: s, description: s, focus_keyword: s, noindex: z.boolean().default(false) }).nullable().optional(),
  provenance: z.record(z.string(), z.string().nullable()).default({}),
  needs_review: z.boolean().default(false),
  review_notes: z.array(z.string()).default([]),
});
export type SeedProduct = z.infer<typeof seedProductSchema>;

export const seedFaqSchema = z.object({
  key: z.string().min(1),
  product_sku: z.string().nullable(),
  question: z.string().min(1),
  answer: z.string().nullable(),
  source: z.string().nullable().optional(),
  status: z.enum(['approved', 'draft', 'needs_client']),
  sort: z.number().int().default(0),
});
export type SeedFaq = z.infer<typeof seedFaqSchema>;

/** Optional `data/seed/collections.json` record; without the file collections are derived from product codes. */
export const seedCollectionSchema = z.object({
  code: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  name_kn: z.string().nullable().optional(),
  kind: z.enum(['plant', 'input']),
  parent: z.string().nullable().optional(),
  position: z.number().int().default(0),
  intro_html: z.string().nullable().optional(),
  seo_title: z.string().nullable().optional(),
  seo_description: z.string().nullable().optional(),
});
export type SeedCollection = z.infer<typeof seedCollectionSchema>;

export interface MappedTag {
  slug: string;
  name: string;
  kind: TagKind;
}
export interface MappedFaq {
  key: string;
  question: string;
  answerHtml: string | null;
  status: FaqStatus;
  source: string | null;
  position: number;
}
export interface MappedImage {
  src: string;
  role: MediaRole;
  position: number;
}
export interface MappedSeedProduct {
  fields: Omit<ProductFields, 'collectionId'>;
  collectionCode: string;
  subcategory: string | null;
  variants: VariantFields[];
  tags: MappedTag[];
  faqs: MappedFaq[];
  images: MappedImage[];
  publishedAt: Date | null;
}

/** Agronomy traits every plant catalogue can derive; trait tags get curated listing pages. */
export const DERIVED_TRAITS = {
  nitrogenFixing: { slug: 'nitrogen-fixing', name: 'Nitrogen fixing', kind: 'trait' },
  droughtTolerant: { slug: 'drought-tolerant', name: 'Drought tolerant', kind: 'trait' },
} as const satisfies Record<string, MappedTag>;

const DERIVED_ALIASES = /^(nitrogen-fix|drought-toler)/;

export function faqStatusFromSeed(status: SeedFaq['status'], source: string | null | undefined): FaqStatus {
  if (status === 'approved') return 'published';
  if (status === 'needs_client') return 'client_only';
  return source === 'ai_draft' ? 'ai_draft' : 'answered';
}

const MEDIA_ROLE_SET = new Set<string>(['main', 'gallery', 'fruit', 'plant', 'as_delivered', 'video_poster']);
const pick = <T extends string>(v: string | null | undefined, allowed: readonly T[]): T | null => (v && (allowed as readonly string[]).includes(v) ? (v as T) : null);
const escapeHtml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Maps one seed record to catalog fields. Pure: prices and stock in the record belong to the pricing and
 * inventory modules' own seed hooks; media ids are resolved by the server from `images[].src`.
 */
export function mapSeedProduct(rec: SeedProduct, slugify: (s: string) => string): MappedSeedProduct {
  const p = rec.plant ?? null;
  const c = p?.climate ?? null;
  const a = p?.attributes ?? null;
  const bearing = parseRange(a?.bearing_years);
  const rotation = parseRange(a?.timber_rotation_years);
  const spacingFt: Record<string, [number, number] | number | null> = {};
  for (const [model, v] of Object.entries(p?.models ?? {})) spacingFt[model] = v?.spacing_ft ?? null;

  const attributes: Record<string, string | null> = {};
  for (const key of ['bearing_years', 'timber_rotation_years', 'fruit_size', 'fruit_shape', 'intercropping'] as const) {
    if (a?.[key]) attributes[key] = a[key];
  }

  const fields = productFieldsSchema.omit({ collectionId: true }).parse({
    sku: rec.sku,
    kind: rec.kind,
    slug: rec.slug,
    name: rec.name_en,
    nameKn: rec.name_kn,
    scientificName: rec.scientific_name,
    baseName: rec.base_name,
    variety: rec.variety,
    subcategory: rec.subcategory,
    sizeClass: p?.size_class ?? null,
    canopy: p?.canopy,
    propagation: p?.propagation,
    nitrogenFixer: p?.nitrogen_fixer ?? false,
    droughtTolerance: p?.drought_tolerance,
    waterNeed: c?.water_need,
    exposure: c?.exposure,
    tempMin: c?.temp_c?.min,
    tempOpt: c?.temp_c?.opt,
    tempMax: c?.temp_c?.max,
    humidityMin: c?.humidity_pct?.min,
    humidityOpt: c?.humidity_pct?.opt,
    humidityMax: c?.humidity_pct?.max,
    rainfallMin: c?.rainfall_mm?.min == null ? null : Math.round(c.rainfall_mm.min),
    rainfallMax: c?.rainfall_mm?.max == null ? null : Math.round(c.rainfall_mm.max),
    soilTags: c?.soil_tags ?? [],
    matureHeightMinFt: a?.mature_height_ft?.min,
    matureHeightMaxFt: a?.mature_height_ft?.max,
    bearingYearsMin: bearing.min,
    bearingYearsMax: bearing.max,
    timberRotationYears: rotation.min,
    yieldText: a?.yield_per_tree,
    harvestSeason: a?.harvest_season,
    attributes,
    spacingFt,
    compostKg: p?.compost_kg
      ? { at_planting: p.compost_kg.at_planting ?? null, y0_2: p.compost_kg.y0_2 ?? null, y3_6: p.compost_kg.y3_6 ?? null, y7_plus: p.compost_kg.y7_plus ?? null }
      : null,
    inputType: rec.kind === 'input' && rec.subcategory ? slugify(rec.subcategory).replace(/-/g, '_') : null,
    packSize: rec.input?.pack_size != null ? `${rec.input.pack_size}${rec.input.unit ? ` ${rec.input.unit}` : ''}` : null,
    dosageRules: rec.input?.dosage_rules ?? null,
    shortDescription: rec.content?.short_description,
    descriptionHtml: rec.content?.description_html,
    status: rec.status,
    isFeatured: rec.is_featured,
    isBestSeller: rec.is_best_seller,
    weightKg: rec.variants[0]?.weight_kg,
    hsn: rec.tax?.hsn,
    gstRate: rec.tax?.gst_rate,
    taxClass: rec.tax?.tax_class,
    bagSize: rec.variants[0]?.bag_size,
    heightAtDispatchFt: rec.variants[0]?.height_at_dispatch_ft,
    seoTitle: rec.seo?.title,
    seoDescription: rec.seo?.description,
    focusKeyword: rec.seo?.focus_keyword,
    noindex: rec.seo?.noindex ?? false,
    searchAliases: rec.search_aliases,
    needsReview: rec.needs_review,
    reviewNotes: rec.review_notes,
    imageNeeded: rec.media?.image_needed ?? false,
    legacySku: rec.legacy_sku,
    legacyWooId: rec.legacy_woo_id,
    erpItemId: rec.ops_item_id,
    dataSource: rec.provenance,
  });

  const variants: VariantFields[] = rec.variants.map((v, i) => ({
    id: null,
    label: v.label,
    skuSuffix: v.sku && v.sku.startsWith(rec.sku) ? v.sku.slice(rec.sku.length) : `-${String(i + 1).padStart(2, '0')}`,
    isDefault: i === 0,
    heightFt: v.height_at_dispatch_ft ?? null,
    bagSize: v.bag_size ?? null,
    weightKg: v.weight_kg ?? null,
    position: i,
  }));

  const tags = new Map<string, MappedTag>();
  for (const name of rec.tags) {
    const slug = slugify(name);
    if (slug && !DERIVED_ALIASES.test(slug)) tags.set(slug, { slug, name: name.trim(), kind: 'use' });
  }
  if (fields.nitrogenFixer) tags.set(DERIVED_TRAITS.nitrogenFixing.slug, DERIVED_TRAITS.nitrogenFixing);
  if (fields.droughtTolerance === 'high') tags.set(DERIVED_TRAITS.droughtTolerant.slug, DERIVED_TRAITS.droughtTolerant);

  const faqs: MappedFaq[] = (rec.content?.faqs ?? []).map((f, i) => ({
    key: `${rec.sku}:faq-${i + 1}`,
    question: f.q,
    answerHtml: f.a ? `<p>${escapeHtml(f.a)}</p>` : null,
    status: faqStatusFromSeed(pick(f.status, ['approved', 'draft', 'needs_client'] as const) ?? 'draft', f.source),
    source: f.source ?? null,
    position: i,
  }));

  const images: MappedImage[] = (rec.media?.images ?? []).map((img, i) => ({
    src: img.src,
    role: (img.role && MEDIA_ROLE_SET.has(img.role) ? img.role : i === 0 ? 'main' : 'gallery') as MediaRole,
    position: i,
  }));

  const publishedAt = rec.published_at ? new Date(rec.published_at) : null;
  return { fields, collectionCode: rec.collection, subcategory: rec.subcategory ?? null, variants, tags: [...tags.values()], faqs, images, publishedAt };
}

/** Collections derived from product codes when no collections.json exists: one top collection per code, one child per subcategory. */
export function deriveCollections(records: readonly SeedProduct[], slugify: (s: string) => string): SeedCollection[] {
  const out = new Map<string, SeedCollection>();
  let pos = 0;
  for (const r of records) {
    if (!out.has(r.collection)) {
      const name = r.collection.charAt(0).toUpperCase() + r.collection.slice(1);
      out.set(r.collection, { code: r.collection, slug: slugify(r.collection), name, kind: r.kind, parent: null, position: pos++ });
    }
  }
  for (const r of records) {
    const parent = out.get(r.collection)!;
    if (!r.subcategory || r.kind === 'input') continue;
    const slug = subcollectionSlug(r.subcategory, slugify);
    if (slug === parent.slug || slugify(r.subcategory) === slugify(parent.name)) continue;
    const code = `${r.collection}/${slug}`;
    if (!out.has(code)) out.set(code, { code, slug, name: r.subcategory, kind: r.kind, parent: r.collection, position: pos++ });
  }
  return [...out.values()];
}

/** "Native & medicinal" -> "native-medicinal": an ampersand is a separator in a path segment, not the word "and". */
export const subcollectionSlug = (label: string, slugify: (s: string) => string): string => slugify(label.replace(/&/g, ' '));
