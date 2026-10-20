// Step 9.3: turn the normalised client rows + Woo matches into the seed product records (data/seed/SCHEMA.md,
// research section 12): price rules, logistics, tax, stock, attributes, content, images, SEO, provenance.
// Also builds Agarwood (from Woo) and the Woo-only legacy plants as hidden drafts (A18), and writes the
// row -> match -> price review CSV.
import { join } from 'node:path';
// @boundaries-ignore type-only: the seed-hook contract; @tooling/scripts cannot depend on core (core depends on it for db helpers)
import type { SeedContext } from '../../../packages/core/src/contracts/extensions';
import { cleanLine, cleanText, csvCell, once, paths, readJson, roundBulk, slugify, SOURCES, writeIfChanged, writeSeedFile } from './lib/common';
import { type MediaRole, registerProductImage, registerSiteImage, wooUrlToPath } from './lib/media-plan';
import { AGARWOOD_SKU, type Match, matchPlants, SIZE_VARIANT_DEFAULT_LABEL, SIZE_VARIANTS, wooBySku, wooPlants, wooPropagation, type WooRow } from './match-woo';
import { type Canopy, type Collection, type ModelKey, normalizePlants, type PlantRow, type Propagation, type SizeClass, workbook } from './normalize-plants';
import { sheetByName } from './lib/xlsx';

// ---------- record types (data/seed/SCHEMA.md + research section 12) ----------

export type Role = 'M' | 'X' | 'O';
export interface Variant {
  sku: string;
  label: string;
  height_at_dispatch_ft: number | null;
  bag_size: string | null;
  price: number;
  compare_at_price: number | null;
  bulk_price: number;
  bulk_min_qty: number;
  offline_price: number | null;
  cost_price: number | null;
  weight_kg: number;
  packing_fee: number;
  stock_qty: number;
  availability: 'in_stock' | 'preorder' | 'out_of_stock';
  ready_in_days: number | null;
  low_stock_threshold: number;
}
export interface ProductImage {
  src: string;
  alt: string;
  w: number;
  h: number;
  role: MediaRole;
}
export interface ProductRecord {
  sku: string;
  legacy_sku: string | null;
  legacy_woo_id: number | null;
  ops_item_id: null;
  source_row: number | null;
  status: 'active' | 'draft';
  kind: 'plant' | 'input';
  data_source: 'client' | 'woo_extra' | 'woo_legacy' | 'placeholder';
  name_en: string;
  base_name: string;
  variety: string | null;
  name_kn: string | null;
  scientific_name: string | null;
  search_aliases: string[];
  slug: string;
  collection: Collection;
  subcategory: string;
  tags: string[];
  is_priority: boolean;
  is_best_seller: boolean;
  is_featured: boolean;
  sourcing: 'own' | 'supplier' | null;
  has_video: { whatsapp: boolean; youtube: boolean };
  plant: PlantBlock | null;
  input: InputBlock | null;
  variants: Variant[];
  tax: { hsn: string; gst_rate: number; tax_class: string; needs_ca_confirmation?: boolean };
  content: { short_description: string | null; description_html: string | null; status: 'approved' | 'ai_draft'; faqs: [] };
  media: { images: ProductImage[]; videos: []; image_needed: boolean };
  seo: { title: string; description: string; focus_keyword: string | null; noindex: boolean; legacy_urls: string[]; google_product_category: string; identifier_exists: false };
  provenance: Record<string, string | null>;
  match: { kind: 'exact' | 'sibling' | 'none'; woo_sku: string | null; confidence: number } | null;
  needs_review: boolean;
  review_notes: string[];
}
export interface PlantBlock {
  size_class: SizeClass;
  canopy: Canopy;
  propagation: Propagation | null;
  nitrogen_fixer: boolean;
  drought_tolerance: 'low' | 'moderate' | 'high' | null;
  climate: {
    temp_c: { opt: number | null; min: number | null; max: number | null };
    humidity_pct: { opt: number | null; min: number | null; max: number | null };
    rainfall_mm: { min: number | null; max: number | null };
    exposure: 'full_sun' | 'partial_shade' | 'shade';
    water_need: 'low' | 'medium' | 'high' | null;
    soil_tags: string[];
  };
  models: Record<ModelKey, { spacing_ft: [number, number] | number; role: Role | null } | null>;
  compost_kg: { at_planting: number | null; y0_2: number | null; y3_6: number | null; y7_plus: number | null; applications_per_year: 2 };
  attributes: {
    mature_height_ft: { min: number | null; max: number | null };
    bearing_years: string | null;
    timber_rotation_years: string | null;
    yield_per_tree: string | null;
    harvest_season: string | null;
    fruit_size: string | null;
    fruit_shape: string | null;
    intercropping: string | null;
  };
}
export interface InputBlock {
  pack_size: number;
  unit: 'kg' | 'L' | 'g' | 'packet';
  pack_weight_kg: number;
  input_type: string;
  dosage_rules: { basis: 'per_plant' | 'per_acre' | 'per_block'; model: string | null; role: Role | null; size_class: SizeClass | null; qty: number; unit: string; note?: string }[];
  recommended_with: string[];
}

// ---------- rules ----------

export const BULK_MIN_QTY: Record<SizeClass, number> = { L: 50, M: 100, S: 200 };
export const WEIGHT_KG: Record<SizeClass, number> = { L: 3, M: 2, S: 1 };
export const PACKING_FEE: Record<SizeClass, number> = { L: 15, M: 10, S: 5 };
export const NATIVE_WEIGHT_KG = 0.8;
export const SLIP_WEIGHT_KG = 0.2;
export const PREORDER_DAYS = 30;
const PLANT_TAX = { hsn: '0602', gst_rate: 0, tax_class: 'plants_nil' };
const GOOGLE_CATEGORY = 'Home & Garden > Plants';
const DEFAULT_SOIL = ['well_drained', 'loam', 'red', 'laterite'];
const SPICES = /pepper|cardamom|nutmeg|clove|cinnamon|all ?spice/i;
/** Researched timber rotation (research section 2), by base or scientific name. */
const TIMBER_ROTATION: [RegExp, string][] = [
  [/^teak|tectona/i, '20 to 25'],
  [/mahogany|swietenia/i, '12 to 15'],
  [/melia dubia/i, '6 to 8'],
  [/red sand|pterocarpus santalinus/i, '20 to 25'],
  [/sandalwood|santalum/i, '15 to 20'],
];
const MODEL_LABEL: Record<ModelKey, string> = { food_forest: 'food forest', miyawaki: 'Miyawaki', commercial: 'commercial', boundary: 'boundary' };
const CANOPY_TEXT: Record<Canopy, string> = { large_tree: 'large tree', medium_tree: 'medium tree', small_tree: 'small tree', shrub: 'shrub', climber: 'climber' };
export const PROPAGATION_TEXT: Record<Propagation, string> = {
  seeded: 'seed-raised', grafted: 'grafted', air_layered: 'air-layered', cuttings: 'cutting-raised', suckers: 'sucker-raised', tissue_culture: 'tissue-culture', other: 'slip-raised',
};
const HEIGHT_BY_CANOPY: Record<Canopy, [number | null, number | null]> = {
  large_tree: [30, 60], medium_tree: [15, 30], small_tree: [6, 15], shrub: [3, 8], climber: [null, null],
};

/** Default role per plant per model (A12): biomass or size S = O, size M = X, size L = M. */
export function defaultRole(p: { size_class: SizeClass; subcategory: string; tags: string[] }): Role {
  if (p.subcategory === 'Biomass & support' || p.tags.includes('biomass') || p.size_class === 'S') return 'O';
  return p.size_class === 'M' ? 'X' : 'M';
}

/** Plant list / FAQ tab labels -> the Plant data rows they mean (research section 8). */
export const LABEL_TO_ROWS: Record<string, (p: PlantRow) => boolean> = {
  'White Sandalwood': (p) => p.base_name === 'Sandalwood',
  'Dragon fruit': (p) => p.base_name === 'Dragonfruit',
  Guava: (p) => p.base_name === 'Guava',
  Avocado: (p) => p.base_name === 'Avocado',
  'Custard apple': (p) => p.base_name === 'Custard Apple',
  Coconut: (p) => p.base_name === 'Coconut',
  Jackfruit: (p) => p.base_name === 'Jackfruit',
  Mango: (p) => p.base_name === 'Mango',
  Apple: (p) => p.base_name === 'Apple',
  Pepper: (p) => p.base_name === 'Pepper',
  Cardamom: (p) => p.base_name === 'Cardamom',
  Cinnamon: (p) => p.base_name === 'Cinnamon',
  Areca: (p) => p.base_name === 'Arecanut',
  'Red sandar': (p) => p.base_name === 'Red sandal',
  Mahagony: (p) => p.base_name === 'Mahogany',
  'Melia dubia': (p) => p.scientific_name.startsWith('Melia dubia'),
  Nutmeg: (p) => p.base_name.startsWith('Nutmeg'),
  Clove: (p) => p.base_name === 'Clove',
  Chikku: (p) => p.base_name === 'Sapota / Chikku',
  Papaya: (p) => p.base_name === 'Papaya',
  Banana: (p) => p.base_name === 'Banana',
  Macadamia: (p) => p.base_name.startsWith('Macadamia'),
  'Sweet lime (Musambi)': (p) => p.base_name === 'Mosumbi',
  Orange: (p) => p.base_name === 'Orange',
  Teak: (p) => p.base_name === 'Teak',
  'Sweet tamarind': (p) => p.base_name === 'Sweet tamarind',
  Jamun: (p) => p.base_name.startsWith('Jamun'),
  Bamboo: (p) => p.base_name === 'Bamboo',
};
/** Real Hasiru field photos from the current site, added to these plants' galleries (research image section 5). */
const FIELD_PHOTOS: { file: string; match: (p: PlantRow) => boolean }[] = [
  { file: 'harvest_amla_gooseberry_hand_hasiru_agro.webp', match: (p) => p.base_name === 'Amla' },
  { file: 'harvest_avocado_picking_hasiru_agro.webp', match: (p) => p.base_name === 'Avocado' },
  { file: 'harvest_guava_abundant_farmer_hasiru_agro.webp', match: (p) => p.base_name === 'Guava' },
  { file: 'process_harvest_jackfruit_farmer_hasiru_agro.webp', match: (p) => p.base_name === 'Jackfruit' },
  { file: 'process_planting_coconut_sapling_hasiru_agro.webp', match: (p) => p.base_name === 'Coconut' },
  { file: 'planting_sandalwood_saplings_nursery_hasiru_agro.webp', match: (p) => p.base_name === 'Sandalwood' },
  { file: 'transformation_papaya_drip_irrigation_hasiru_agro.webp', match: (p) => p.base_name === 'Papaya' },
  { file: 'transformation_papaya_saplings_growing_hasiru_agro.webp', match: (p) => p.base_name === 'Papaya' },
];
const WOO_COLLECTION: Record<string, { collection: Collection; subcategory: string }> = {
  'Desi Fruits': { collection: 'fruiting', subcategory: 'Desi' },
  'Exotic fruits': { collection: 'fruiting', subcategory: 'Exotic' },
  Forestry: { collection: 'timber', subcategory: 'Timber' },
  Spices: { collection: 'other', subcategory: 'Spices' },
  Plantation: { collection: 'other', subcategory: 'Plantation' },
};

// ---------- helpers ----------

const int = (s: string | undefined): number | null => {
  const n = parseInt((s ?? '').replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};
const numbersIn = (s: string) => [...s.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));

export function normaliseExposure(raw: string | null): PlantBlock['climate']['exposure'] | null {
  const s = (raw ?? '').toLowerCase();
  if (!s || !/sun|shade/.test(s)) return null;
  if (/^(full|open) sun|^full sunlight/.test(s)) return 'full_sun';
  if (/full shade/.test(s)) return 'shade';
  return 'partial_shade';
}

function heightFromWoo(raw: string | null): { min: number | null; max: number | null } | null {
  if (!raw || !/ft/i.test(raw)) return null;
  const n = numbersIn(raw);
  return n.length ? { min: Math.min(...n), max: Math.max(...n) } : null;
}

const SOIL_WORDS: [RegExp, string][] = [
  [/red/i, 'red'], [/black/i, 'black'], [/laterite/i, 'laterite'], [/alluvial/i, 'alluvial'], [/sand/i, 'sandy'],
  [/loam/i, 'loam'], [/clay/i, 'clay'], [/well[- ]?drain/i, 'well_drained'],
];
const soilTags = (raw: string | null) => (raw ? SOIL_WORDS.filter(([re]) => re.test(raw)).map(([, t]) => t) : []);

/** WordPress-style slug of an old product name (sanitize_title): apostrophes dropped, rest hyphenated. */
export const wpSlug = (name: string) => slugify(name.replace(/['’]/g, ''));

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const stripTags = (s: string) => cleanText(s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&'));
/** Old short descriptions sometimes carry copywriting scaffolding ("Product Title: ...", "Short Description:"). */
export const wooShort = (raw: string) =>
  stripTags(raw)
    .replace(/^Product Title:[^\n]*(\n+[^\n]*?(?=\n\nShort Description:))?/i, '')
    .replace(/^\s*Short Description:\s*/im, '')
    .trim();

/** Woo long description -> HTML: kept when it already is HTML, else paragraphs (sanitised again on import). */
export function wooHtml(raw: string): string | null {
  const text = cleanText(raw);
  if (!text) return null;
  if (/<\w+[^>]*>/.test(text)) return text;
  return text
    .split(/\n\n+/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

const firstSentences = (text: string, max = 155) => {
  const s = text.replace(/\s*\n+\s*/g, ' ');
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(', '));
  return (stop > 80 ? cut.slice(0, stop + 1) : cut.slice(0, cut.lastIndexOf(' '))).replace(/[,\s]+$/, '').trim();
};

/** SEO title rule (research 2): a real old title, else "Buy {name} Plant Online in Bengaluru | Hasiru Agro" within 60 chars. */
export function seoTitle(name: string, wooTitle: string | null): string {
  if (wooTitle && !wooTitle.includes('%')) return wooTitle;
  const plain = name.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  for (const t of [`Buy ${name} Plant Online in Bengaluru | Hasiru Agro`, `Buy ${name} Plant Online | Hasiru Agro`, `Buy ${plain} Plant Online | Hasiru Agro`, `${plain} | Hasiru Agro`]) {
    if (t.length <= 60) return t;
  }
  return `${plain.slice(0, 44).trim()} | Hasiru Agro`;
}

const modelsList = (keys: ModelKey[]) => {
  const names = keys.map((k) => MODEL_LABEL[k]);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : (names[0] ?? '');
};

const spacingText = (s: [number, number] | number) => (Array.isArray(s) ? `${s[0]} x ${s[1]}` : `${s}`);

/** Template short description (research 6.6), from client data only. */
function templateShort(p: PlantRow, modelKeys: ModelKey[]): string {
  const kn = p.name_kn ? `, ${p.name_kn} in Kannada,` : '';
  const article = /^[aeiou]/i.test(CANOPY_TEXT[p.canopy]) ? 'an' : 'a';
  let s = `${p.name_en}${kn} is ${article} ${CANOPY_TEXT[p.canopy]} sold as a ${PROPAGATION_TEXT[p.propagation]} sapling, suited to ${p.climate.temp_c.min} to ${p.climate.temp_c.max} C and ${p.climate.rainfall_mm.min} to ${p.climate.rainfall_mm.max} mm of rain a year.`;
  const first = modelKeys[0];
  if (first) {
    const sp = p.spacing[first]!;
    s += ` Plant at ${spacingText(sp)} ft in a ${modelsList(modelKeys)} layout.`;
  }
  return s;
}

/** Template long description: marked ai_draft + needs_review, never published as approved copy. */
function templateHtml(p: PlantRow, modelKeys: ModelKey[]): string {
  const c = p.climate;
  const parts = [
    `<p>${escapeHtml(p.name_en)}${p.is_native ? '' : ` (<em>${escapeHtml(p.scientific_name)}</em>)`} is a ${CANOPY_TEXT[p.canopy]} supplied as a ${PROPAGATION_TEXT[p.propagation]} sapling.${p.nitrogen_fixer ? ' It fixes nitrogen and enriches the soil around it.' : ''}</p>`,
    `<h3>Climate</h3>\n<p>Grows best at about ${c.temp_c.opt} C (range ${c.temp_c.min} to ${c.temp_c.max} C), ${c.humidity_pct.min} to ${c.humidity_pct.max}% humidity and ${c.rainfall_mm.min} to ${c.rainfall_mm.max} mm of rain a year. Drought tolerance: ${p.drought_tolerance}.</p>`,
  ];
  if (modelKeys.length) {
    parts.push(`<h3>Spacing</h3>\n<ul>\n${modelKeys.map((k) => `<li>${MODEL_LABEL[k][0]!.toUpperCase()}${MODEL_LABEL[k].slice(1)}: ${spacingText(p.spacing[k]!)} ft</li>`).join('\n')}\n</ul>`);
  }
  const k = p.compost_kg;
  const steps = [
    k.at_planting !== null ? `${k.at_planting} kg at planting` : null,
    k.y0_2 !== null ? `${k.y0_2} kg twice a year in years 1 and 2` : null,
    k.y3_6 !== null ? `${k.y3_6} kg twice a year in years 3 to 6` : null,
    k.y7_plus !== null ? `${k.y7_plus} kg twice a year from year 7` : null,
  ].filter(Boolean);
  if (steps.length) parts.push(`<h3>Compost</h3>\n<p>${steps.join(', ')}.</p>`);
  return parts.join('\n');
}

function variantDefaults(propagation: Propagation | null, slip: boolean, native: boolean) {
  if (slip) return { label: 'Rooted slip', height: null, bag: null };
  if (native) return { label: 'Miyawaki sapling, 1 to 1.5 ft, 6x8 in bag', height: 1, bag: '6x8 in' };
  if (propagation === 'grafted' || propagation === 'air_layered' || propagation === 'tissue_culture') return { label: '1.5 to 2 ft, 8x10 in bag', height: 1.5, bag: '8x10 in' };
  if (propagation === 'cuttings') return { label: 'Rooted cutting, 6x8 in bag', height: 1, bag: '6x8 in' };
  return { label: '1 to 1.5 ft, 6x8 in bag', height: 1, bag: '6x8 in' };
}

function makeVariant(sku: string, o: { label: string; height: number | null; bag: string | null; price: number; compareAt: number | null; offline: number | null; size: SizeClass; weight: number; stock: number }): Variant {
  const stock = Math.max(0, o.stock);
  const minQty = BULK_MIN_QTY[o.size];
  return {
    sku,
    label: o.label,
    height_at_dispatch_ft: o.height,
    bag_size: o.bag,
    price: o.price,
    compare_at_price: o.compareAt !== null && o.compareAt > o.price ? o.compareAt : null,
    bulk_price: roundBulk(o.price * 0.72),
    bulk_min_qty: minQty,
    offline_price: o.offline,
    cost_price: null,
    weight_kg: o.weight,
    packing_fee: PACKING_FEE[o.size],
    stock_qty: stock,
    availability: stock > 0 ? 'in_stock' : 'preorder',
    ready_in_days: stock > 0 ? null : PREORDER_DAYS,
    low_stock_threshold: minQty,
  };
}

/** Third-party branded photos in the old galleries are never used (research image section 7). */
export const THIRD_PARTY = /saplingmart/i;

function wooImages(w: WooRow, sku: string, alt: string): ProductImage[] {
  return w.Images.split(',')
    .map((u) => u.trim())
    .filter((u) => u && !THIRD_PARTY.test(u))
    .map((url, i) => {
      const role: MediaRole = i === 0 ? 'main' : 'gallery';
      const m = registerProductImage(wooUrlToPath(url), sku, role);
      return { src: m.file, alt, w: m.w, h: m.h, role };
    });
}

interface ImageMapEntry {
  name: string;
  variety: string;
  sku_match: string | null;
  csv_name: string | null;
  confidence: string;
  gallery: { path: string; role: string }[];
}
const imageMap = once(() => {
  const m = readJson<{ plants: Record<string, ImageMapEntry> }>(paths.imageMap()).plants;
  return new Map(Object.values(m).map((e) => [`${cleanLine(e.name)}|${cleanLine(e.variety) ?? ''}`, e]));
});

const wooSeo = (w: WooRow) => ({
  title: cleanLine(w['Meta: rank_math_title']),
  description: cleanLine(w['Meta: _yoast_wpseo_metadesc']) ?? cleanLine(w['Meta: rank_math_description']),
  focus: cleanLine(w['Meta: rank_math_focus_keyword']) ?? cleanLine(w['Meta: _yoast_wpseo_focuskw']),
});

function wooAttributes(w: WooRow) {
  return {
    bearing_years: cleanLine(w['Meta: bearing-time']),
    yield_per_tree: cleanLine(w['Meta: yield-per-tree']),
    harvest_season: cleanLine(w['Meta: harvesting-season']),
    fruit_size: cleanLine(w['Meta: fruit-size']),
    fruit_shape: cleanLine(w['Meta: fruit-shape']),
    intercropping: cleanLine(w['Meta: intercropping']),
  };
}

// ---------- builders ----------

export interface Built {
  products: ProductRecord[];
  reviewCsv: string;
}

/** Price per research 6.1: exact = Woo sale, sibling = sibling sale, else the researched or native-band price. */
function fillPrice(p: PlantRow, match: Match, w: WooRow | null, notes: string[]): { price: number; priceSource: string } {
  // price (research 6.1)
  let price: number;
  let priceSource: string;
  if (match.kind === 'exact') {
    price = int(w!['Sale price'])!;
    priceSource = 'woo';
  } else if (match.kind === 'sibling') {
    price = int(w!['Sale price'])!;
    priceSource = 'woo_sibling';
    notes.push(`Price borrowed from the old listing "${cleanLine(w!.Name)}" (same species, other variety); confirm.`);
  } else {
    price = p.research.price;
    priceSource = p.is_native ? 'researched_native' : 'researched';
    notes.push(p.is_native ? 'Native sapling price from the university nursery band; confirm.' : 'Researched price (no old listing); confirm.');
  }
  if (match.pinned) notes.push(`Match decided by hand: ${match.pinned}.`);
  return { price, priceSource };
}

/** Default variant (+ the second size for Mangosteen and Rambutan), logistics defaults per research 6.2. */
function clientVariants(p: PlantRow, sku: string, price: number, exact: WooRow | null, notes: string[]): Variant[] {
  const woo = wooBySku();
  const slip = (p.propagation === 'cuttings' || p.propagation === 'other') && price < 30;
  const weight = p.is_native ? NATIVE_WEIGHT_KG : slip ? SLIP_WEIGHT_KG : WEIGHT_KG[p.size_class];
  const def = variantDefaults(p.propagation, slip, p.is_native);
  const sizeLabel = exact ? SIZE_VARIANT_DEFAULT_LABEL[exact.SKU] : undefined;
  const variants: Variant[] = [
    makeVariant(`${sku}-01`, {
      label: sizeLabel?.label ?? def.label,
      height: sizeLabel?.height_ft ?? def.height,
      bag: sizeLabel ? null : def.bag,
      price,
      compareAt: exact ? int(exact['Regular price']) : null,
      offline: exact ? int(exact['Meta: offlineprice']) : null,
      size: p.size_class,
      weight,
      stock: exact ? (int(exact.Stock) ?? 0) : 0,
    }),
  ];
  if (exact) {
    for (const [vSku, v] of Object.entries(SIZE_VARIANTS)) {
      if (v.parent !== exact.SKU) continue;
      const big = woo.get(vSku)!;
      variants.push(
        makeVariant(`${sku}-02`, {
          label: v.label, height: v.height_ft, bag: null, price: int(big['Sale price'])!, compareAt: int(big['Regular price']),
          offline: int(big['Meta: offlineprice']), size: p.size_class, weight: WEIGHT_KG.L, stock: int(big.Stock) ?? 0,
        }),
      );
      notes.push(`Second size from the old listing ${vSku}; weight is a placeholder.`);
    }
  }
  if (!exact) notes.push(`No stock data: preorder, ready in ${PREORDER_DAYS} days (placeholder).`);
  notes.push('Bag size, dispatch height and weight are defaults by propagation and size; confirm.');
  return variants;
}

/** Images: the old listing's gallery (or the image map's species photo, flagged), plus real field photos. */
function clientImages(p: PlantRow, sku: string, exact: WooRow | null, notes: string[]): ProductImage[] {
  // images (research 6.7, image inventory)
  const alt = `${p.name_en} sapling${p.name_kn ? `, ${p.name_kn}` : ''}`;
  const im = imageMap().get(`${p.raw_name}|${p.raw_variety ?? ''}`);
  let images: ProductImage[] = [];
  if (exact && (!im || im.sku_match !== exact.SKU || !im.gallery.length)) {
    images = wooImages(exact, sku, alt);
  } else if (im?.gallery.length) {
    images = im.gallery.map((g, i) => {
      const r: MediaRole = i === 0 ? 'main' : g.role === 'sapling' ? 'as_delivered' : 'gallery';
      const m = registerProductImage(g.path, sku, r);
      return { src: m.file, alt: r === 'as_delivered' ? `${alt}, as delivered` : alt, w: m.w, h: m.h, role: r };
    });
    if (!exact || im.confidence !== 'high') notes.push(`Photo is from the old listing "${cleanLine(im.csv_name)}" (${im.confidence} confidence); replace photo.`);
  }
  for (const f of FIELD_PHOTOS.filter((x) => x.match(p))) {
    const m = registerSiteImage(f.file, sku);
    images.push({ src: m.file, alt: `${alt}, Hasiru Agro field photo`, w: m.w, h: m.h, role: images.length ? 'gallery' : 'main' });
  }
  if (!images.length) notes.push('No photo yet: shows the collection placeholder until a real photo is added.');
  return images;
}

function clientRecord(p: PlantRow, match: Match, flags: PlantListFlag | undefined): ProductRecord {
  const sku = `HAP-${String(p.source_row - 3).padStart(4, '0')}`;
  const w = match.woo_sku ? wooBySku().get(match.woo_sku)! : null;
  const exact = match.kind === 'exact' ? w : null;
  const notes = [...p.review_notes];
  const { price, priceSource } = fillPrice(p, match, w, notes);
  const variants = clientVariants(p, sku, price, exact, notes);

  // models and roles (A12)
  const role = defaultRole(p);
  const modelKeys = (['food_forest', 'miyawaki', 'commercial', 'boundary'] as ModelKey[]).filter((k) => p.spacing[k] !== null);
  const models = Object.fromEntries(
    (['food_forest', 'miyawaki', 'commercial', 'boundary'] as ModelKey[]).map((k) => [k, p.spacing[k] === null ? null : { spacing_ft: p.spacing[k]!, role }]),
  ) as PlantBlock['models'];

  // attributes (research 6.5)
  const wooAttr = exact ? wooAttributes(exact) : null;
  const siblingBearing = match.kind === 'sibling' ? cleanLine(w!['Meta: bearing-time']) : null;
  if (siblingBearing) notes.push('Bearing time copied from the sibling listing; confirm.');
  const height = (exact && heightFromWoo(cleanLine(exact['Meta: growth-habit']))) || { min: HEIGHT_BY_CANOPY[p.canopy][0], max: HEIGHT_BY_CANOPY[p.canopy][1] };
  const exposure = (exact && normaliseExposure(cleanLine(exact['Meta: exposure']))) || (SPICES.test(p.base_name) ? 'partial_shade' : 'full_sun');
  const soil = exact ? soilTags(cleanLine(exact['Meta: soiltype'])) : [];
  if (!soil.length) notes.push('Soil preference is a default (not in the client file); confirm.');
  const rotation = p.collection === 'timber' || p.tags.includes('forestry_timber') ? (TIMBER_ROTATION.find(([re]) => re.test(p.base_name) || re.test(p.scientific_name))?.[1] ?? null) : null;

  // content
  let short: string | null;
  let html: string | null;
  let contentStatus: 'approved' | 'ai_draft';
  if (exact) {
    short = wooShort(exact['Short description']) || templateShort(p, modelKeys);
    html = wooHtml(exact.Description) ?? templateHtml(p, modelKeys);
    contentStatus = 'approved';
  } else {
    short = templateShort(p, modelKeys);
    html = templateHtml(p, modelKeys);
    contentStatus = 'ai_draft';
    notes.push('Descriptions are template drafts from the plant data; review before publishing copy.');
  }
  const images = clientImages(p, sku, exact, notes);
  const seo = exact ? wooSeo(exact) : null;
  const record: ProductRecord = {
    sku,
    legacy_sku: exact?.SKU ?? null,
    legacy_woo_id: exact ? int(exact.ID) : null,
    ops_item_id: null,
    source_row: p.source_row,
    status: 'active',
    kind: 'plant',
    data_source: 'client',
    name_en: p.name_en,
    base_name: p.base_name,
    variety: p.variety,
    name_kn: p.name_kn,
    scientific_name: p.scientific_name,
    search_aliases: [...new Set([...p.search_aliases, ...(exact ? [cleanLine(exact.Name)!] : [])])].filter((a) => a !== p.name_en).sort(),
    slug: slugify(p.slug_base),
    collection: p.collection,
    subcategory: p.subcategory,
    tags: p.tags,
    is_priority: !!flags,
    is_best_seller: !!flags,
    is_featured: exact?.['Is featured?'] === '1',
    sourcing: flags ? (flags.supplier ? 'supplier' : 'own') : null,
    has_video: { whatsapp: flags?.whatsapp ?? false, youtube: flags?.youtube ?? false },
    plant: {
      size_class: p.size_class,
      canopy: p.canopy,
      propagation: p.propagation,
      nitrogen_fixer: p.nitrogen_fixer,
      drought_tolerance: p.drought_tolerance,
      climate: {
        ...p.climate,
        exposure,
        water_need: ({ high: 'low', moderate: 'medium', low: 'high' } as const)[p.drought_tolerance],
        soil_tags: soil.length ? soil : DEFAULT_SOIL,
      },
      models,
      compost_kg: p.compost_kg,
      attributes: {
        mature_height_ft: height,
        bearing_years: wooAttr?.bearing_years ?? siblingBearing,
        timber_rotation_years: rotation,
        yield_per_tree: wooAttr?.yield_per_tree ?? null,
        harvest_season: wooAttr?.harvest_season ?? null,
        fruit_size: wooAttr?.fruit_size ?? null,
        fruit_shape: wooAttr?.fruit_shape ?? null,
        intercropping: wooAttr?.intercropping ?? null,
      },
    },
    input: null,
    variants,
    tax: PLANT_TAX,
    content: { short_description: short, description_html: html, status: contentStatus, faqs: [] },
    media: { images, videos: [], image_needed: images.length === 0 },
    seo: {
      title: seoTitle(p.name_en, seo?.title ?? null),
      description: seo?.description ?? firstSentences(short),
      focus_keyword: seo?.focus ?? null,
      noindex: false,
      legacy_urls: exact ? [`/product/${wpSlug(exact.Name)}`] : [],
      google_product_category: GOOGLE_CATEGORY,
      identifier_exists: false,
    },
    provenance: {
      identity: 'client',
      climate: 'client',
      models: 'placeholder',
      compost: 'client',
      attributes: exact ? 'woo' : match.kind === 'sibling' ? 'woo_sibling' : 'derived',
      price: priceSource,
      stock: exact ? 'woo' : 'placeholder',
      content: exact ? 'woo' : 'ai_draft',
      images: images.length ? 'woo' : 'placeholder',
      seo: seo?.title || seo?.description ? 'woo' : 'derived',
    },
    match: { kind: match.kind, woo_sku: match.woo_sku, confidence: match.confidence },
    needs_review: true,
    review_notes: notes,
  };
  record.needs_review = priceSource !== 'woo' || contentStatus !== 'approved' || record.media.image_needed || p.review_notes.length > 0 || notes.some((n) => /replace photo/.test(n));
  return record;
}

const csvRow = (r: ProductRecord, extra: { suggested: string; pin: string; wooName: string }) => {
  const v = r.variants[0]!;
  return [
    String(r.source_row ?? ''), r.sku, r.name_en, r.status, r.match?.kind ?? '', r.match?.woo_sku ?? '', extra.wooName, String(r.match?.confidence ?? ''),
    extra.suggested, extra.pin, String(v.price), String(v.compare_at_price ?? ''), String(v.bulk_price), String(v.bulk_min_qty), r.provenance.price ?? '',
    String(v.stock_qty), String(r.media.images.length), String(r.media.image_needed), String(r.needs_review),
  ];
};

export const buildProducts = once((): Built => {
  const rows = normalizePlants();
  const matches = matchPlants();
  const woo = wooBySku();
  const csv: string[][] = [[
    'source_row', 'sku', 'name_en', 'status', 'match', 'woo_sku', 'woo_name', 'confidence', 'scoring_suggested', 'pin_reason',
    'price', 'compare_at_price', 'bulk_price', 'bulk_min_qty', 'price_source', 'stock_qty', 'images', 'image_needed', 'needs_review',
  ]];
  const plantList = plantListFlags();
  const products: ProductRecord[] = [];

  for (const p of rows) {
    const match = matches.get(p.source_row)!;
    const record = clientRecord(p, match, plantList.get(p.source_row));
    products.push(record);
    const w = match.woo_sku ? woo.get(match.woo_sku) : undefined;
    csv.push(csvRow(record, { suggested: `${match.suggested.kind}:${match.suggested.woo_sku ?? ''}`, pin: match.pinned ?? '', wooName: w ? cleanLine(w.Name)! : '' }));
  }

  // Agarwood (client lists it; not in Plant data) and the Woo-only legacy plants
  const used = new Set<string>([AGARWOOD_SKU, ...Object.keys(SIZE_VARIANTS)]);
  for (const m of matches.values()) if (m.kind === 'exact' && m.woo_sku) used.add(m.woo_sku);
  const catalog = new Map(readJson<{ id: string; sz: SizeClass }[]>(paths.wooCatalog()).map((c) => [c.id, c]));
  const takenSlugs = new Set(products.map((x) => x.slug));
  let next = rows.length + 1;
  const extra = [woo.get(AGARWOOD_SKU)!, ...wooPlants().filter((x) => !used.has(x.SKU))];
  for (const x of extra) {
    const sku = `HAP-${String(next++).padStart(4, '0')}`;
    const record = legacyRecord(x, sku, catalog.get(x.SKU)?.sz ?? 'M', x.SKU === AGARWOOD_SKU);
    let slug = record.slug;
    for (let n = 2; takenSlugs.has(slug); n++) slug = `${record.slug}-${n}`;
    record.slug = slug;
    takenSlugs.add(slug);
    products.push(record);
    csv.push(csvRow(record, { suggested: '', pin: x.SKU === AGARWOOD_SKU ? 'Agarwood: client Plant list and FAQs' : 'woo_legacy draft', wooName: cleanLine(x.Name)! }));
  }
  products.sort((a, b) => a.sku.localeCompare(b.sku));
  return { products, reviewCsv: `${csv.map((r) => r.map(csvCell).join(',')).join('\n')}\n` };
});

/** Agarwood (A19) and the Woo-only plants (A18): old-shop data, hidden drafts except Agarwood. */
function legacyRecord(w: WooRow, sku: string, size: SizeClass, isAgarwood: boolean): ProductRecord {
  const name = cleanLine(w.Name)!.replace(/\s*\(\s*/g, ' (').replace(/\s*\)/g, ')');
  const mapped = WOO_COLLECTION[w.Categories] ?? { collection: 'fruiting' as const, subcategory: 'Exotic' };
  const propagation = wooPropagation(w);
  const notes: string[] = [];
  const temp = numbersIn(cleanLine(w['Meta: temperature']) ?? '').filter((n) => n < 60);
  const canopy: Canopy = size === 'L' ? 'large_tree' : size === 'M' ? 'medium_tree' : 'small_tree';
  const alt = `${name} sapling`;
  const images = wooImages(w, sku, alt);
  const seo = wooSeo(w);
  const short = wooShort(w['Short description']) || null;
  const html = wooHtml(w.Description);
  const exposure = normaliseExposure(cleanLine(w['Meta: exposure'])) ?? 'full_sun';
  if (isAgarwood) {
    notes.push('Not in the client Plant data: climate is researched; client to add spacing, compost and the Kannada name.');
  } else {
    notes.push('Old-shop product not in the client file: add spacing, climate and compost, then publish or delete.');
  }
  if (!images.length) notes.push('No photo yet.');
  const wooAttr = wooAttributes(w);
  const climate: PlantBlock['climate'] = isAgarwood
    ? {
        // Aquilaria malaccensis: humid tropical lowland forest tree (researched)
        temp_c: { opt: 27, min: 20, max: 35 },
        humidity_pct: { opt: 80, min: 65, max: 95 },
        rainfall_mm: { min: 1500, max: 4000 },
        exposure: 'partial_shade',
        water_need: 'high',
        soil_tags: ['well_drained', 'loam', 'laterite'],
      }
    : {
        temp_c: { opt: temp.length > 1 ? Math.round((temp[0]! + temp.at(-1)!) / 2) : null, min: temp.length > 1 ? Math.min(...temp) : null, max: temp.length > 1 ? Math.max(...temp) : null },
        humidity_pct: { opt: null, min: null, max: null },
        rainfall_mm: { min: null, max: null },
        exposure,
        water_need: null,
        soil_tags: soilTags(cleanLine(w['Meta: soiltype'])),
      };
  const height = heightFromWoo(cleanLine(w['Meta: growth-habit'])) ?? { min: HEIGHT_BY_CANOPY[canopy][0], max: HEIGHT_BY_CANOPY[canopy][1] };
  const def = variantDefaults(propagation, false, false);
  const sizeLabel = SIZE_VARIANT_DEFAULT_LABEL[w.SKU];
  return {
    sku,
    legacy_sku: w.SKU,
    legacy_woo_id: int(w.ID),
    ops_item_id: null,
    source_row: null,
    status: isAgarwood ? 'active' : 'draft',
    kind: 'plant',
    data_source: isAgarwood ? 'woo_extra' : 'woo_legacy',
    name_en: name,
    base_name: name,
    variety: null,
    name_kn: null,
    scientific_name: isAgarwood ? 'Aquilaria malaccensis' : null,
    search_aliases: [],
    slug: slugify(name),
    collection: mapped.collection,
    subcategory: mapped.subcategory,
    tags: isAgarwood ? ['forestry_timber', 'medicinal'] : [],
    is_priority: isAgarwood,
    is_best_seller: isAgarwood,
    is_featured: w['Is featured?'] === '1',
    sourcing: isAgarwood ? 'supplier' : null,
    has_video: { whatsapp: false, youtube: false },
    plant: {
      size_class: size,
      canopy,
      propagation,
      nitrogen_fixer: false,
      drought_tolerance: null,
      climate,
      models: { food_forest: null, miyawaki: null, commercial: null, boundary: null },
      compost_kg: { at_planting: null, y0_2: null, y3_6: null, y7_plus: null, applications_per_year: 2 },
      attributes: { mature_height_ft: height, timber_rotation_years: null, ...wooAttr },
    },
    input: null,
    variants: [
      makeVariant(`${sku}-01`, {
        label: sizeLabel?.label ?? def.label, height: sizeLabel?.height_ft ?? def.height, bag: sizeLabel ? null : def.bag,
        price: int(w['Sale price'])!, compareAt: int(w['Regular price']), offline: int(w['Meta: offlineprice']), size, weight: WEIGHT_KG[size], stock: int(w.Stock) ?? 0,
      }),
    ],
    tax: PLANT_TAX,
    content: { short_description: short, description_html: html, status: 'approved', faqs: [] },
    media: { images, videos: [], image_needed: images.length === 0 },
    seo: {
      title: seoTitle(name, seo.title),
      description: seo.description ?? firstSentences(short ?? name),
      focus_keyword: seo.focus,
      noindex: !isAgarwood,
      legacy_urls: [`/product/${wpSlug(w.Name)}`],
      google_product_category: GOOGLE_CATEGORY,
      identifier_exists: false,
    },
    provenance: {
      identity: 'woo',
      climate: isAgarwood ? 'researched' : null,
      models: null,
      compost: null,
      attributes: 'woo',
      price: 'woo',
      stock: 'woo',
      content: 'woo',
      images: images.length ? 'woo' : 'placeholder',
      seo: seo.title || seo.description ? 'woo' : 'derived',
    },
    match: { kind: 'exact', woo_sku: w.SKU, confidence: 1 },
    needs_review: true,
    review_notes: notes,
  };
}

interface PlantListFlag {
  supplier: boolean;
  whatsapp: boolean;
  youtube: boolean;
  label: string;
}

/** Plant list tab (29 priority plants): priority, supplier sourcing, video flags, per client row. */
export const plantListFlags = once(() => {
  const flags = new Map<number, PlantListFlag>();
  const sheet = plantListSheet();
  for (const [, cells] of sheet) {
    const label = cleanLine(cells[2]);
    if (!label || label === 'Plant name' || typeof cells[1] !== 'number') continue;
    if (label === 'Agarwood') continue; // the extra Woo row, flagged in legacyRecord
    const pick = LABEL_TO_ROWS[label];
    if (!pick) throw new Error(`Plant list label "${label}" has no mapping`);
    const hits = normalizePlants().filter(pick);
    if (!hits.length) throw new Error(`Plant list label "${label}" matched no Plant data row`);
    const yes = (c: unknown) => cleanLine(c)?.toLowerCase() === 'yes';
    for (const h of hits) flags.set(h.source_row, { supplier: yes(cells[6]), whatsapp: yes(cells[3]), youtube: yes(cells[4]), label });
  }
  return flags;
});

const plantListSheet = once(() => sheetByName(workbook(), 'Plant list'));

export const REVIEW_CSV = 'match-review.csv';

export default async function step(ctx: SeedContext): Promise<void> {
  const { products, reviewCsv } = buildProducts();
  const wrote = writeSeedFile(join(ctx.seedDir, 'products.json'), [SOURCES.xlsx, SOURCES.woo, SOURCES.catalog, SOURCES.imageMap, SOURCES.research], products, ctx);
  writeIfChanged(join(ctx.seedDir, REVIEW_CSV), reviewCsv, ctx);
  const by = (s: string) => products.filter((p) => p.data_source === s).length;
  ctx.log.info(`fill-gaps: ${products.length} products (client ${by('client')}, extra ${by('woo_extra')}, legacy drafts ${by('woo_legacy')})${wrote ? '' : ', unchanged'}`);
}
