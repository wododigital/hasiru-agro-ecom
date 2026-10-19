// Generic test catalogue (no store names). Shapes follow data/seed/SCHEMA.md.
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const envelope = (records: unknown) => JSON.stringify({ version: 1, generated_at: '2026-10-20T10:00:00+05:30', sources: ['fixture'], records }, null, 2);

const plant = (o: Record<string, unknown> & { sku: string }) => ({
  status: 'active',
  kind: 'plant',
  search_aliases: [],
  tags: [],
  is_best_seller: false,
  is_featured: false,
  provenance: { identity: 'client', price: 'researched' },
  needs_review: false,
  review_notes: [],
  ...o,
});

export const seedProducts = [
  plant({
    sku: 'P-0001',
    legacy_sku: 'OLD-11',
    name_en: 'Alphonso Mango',
    base_name: 'Mango',
    variety: 'Alphonso',
    name_kn: 'ಮಾವು',
    scientific_name: 'Mangifera indica',
    search_aliases: ['Alphonoso Mango', 'maavu'],
    slug: 'alphonso-mango',
    collection: 'fruiting',
    subcategory: 'Desi',
    tags: ['Medicinal'],
    is_best_seller: true,
    plant: {
      size_class: 'L',
      canopy: 'large_tree',
      propagation: 'grafted',
      nitrogen_fixer: false,
      drought_tolerance: 'moderate',
      climate: { temp_c: { opt: 27, min: 15, max: 38 }, humidity_pct: { opt: 60, min: 30, max: 85 }, rainfall_mm: { min: 500, max: 2500 }, exposure: 'full_sun', water_need: 'medium', soil_tags: ['loam'] },
      models: { food_forest: { spacing_ft: [18, 18], role: 'M' }, commercial: { spacing_ft: [18, 18], role: 'M' }, miyawaki: null, boundary: null },
      compost_kg: { at_planting: 5, y0_2: 5, y3_6: 8, y7_plus: 10, applications_per_year: 2 },
      attributes: { mature_height_ft: { min: 30, max: 40 }, bearing_years: '3-4', timber_rotation_years: null, yield_per_tree: '150 to 200 fruits', harvest_season: 'April to June' },
    },
    variants: [{ label: 'Grafted sapling', sku: 'P-0001-01', height_at_dispatch_ft: 2, bag_size: '8x10 in', weight_kg: 3 }],
    tax: { hsn: '0602', gst_rate: 0, tax_class: 'plants_nil' },
    content: {
      short_description: 'A grafted sapling of a popular sweet mango.',
      description_html: '<p>Sweet <strong>fruit</strong>.</p><script>alert(1)</script>',
      faqs: [
        { q: 'When does it fruit?', a: 'Usually from the third year.', source: 'client', status: 'approved' },
        { q: 'Do I need a permit?', a: null, source: 'client', status: 'needs_client' },
      ],
    },
    media: { images: [{ src: 'products/mango-1.webp', alt: 'Mango sapling', role: 'main' }, { src: 'products/mango-2.webp', alt: 'Mango fruit', role: 'fruit' }], image_needed: false },
    seo: { title: 'Buy Alphonso Mango sapling', description: 'Grafted mango sapling.', focus_keyword: 'mango sapling', noindex: false },
  }),
  plant({
    sku: 'P-0002',
    name_en: 'Teak',
    base_name: 'Teak',
    slug: 'teak',
    collection: 'timber',
    subcategory: 'Timber',
    plant: {
      size_class: 'L',
      canopy: 'large_tree',
      propagation: 'seeded',
      nitrogen_fixer: false,
      drought_tolerance: 'high',
      climate: { temp_c: { opt: 30, min: 12, max: 42 }, rainfall_mm: { min: 800, max: 2500 }, soil_tags: [] },
      models: { commercial: { spacing_ft: [10, 10] }, boundary: { spacing_ft: 10 } },
      attributes: { timber_rotation_years: '20-25' },
    },
    variants: [{ label: 'Seedling', weight_kg: 2 }],
  }),
  plant({
    sku: 'P-0003',
    name_en: 'Gliricidia',
    base_name: 'Gliricidia',
    slug: 'gliricidia',
    collection: 'other',
    subcategory: 'Biomass & support',
    tags: ['Biomass', 'Nitrogen fixer'],
    plant: { size_class: 'S', canopy: 'shrub', propagation: 'cuttings', nitrogen_fixer: true, drought_tolerance: 'moderate', models: { boundary: { spacing_ft: 6 } } },
    variants: [{ label: 'Cutting', weight_kg: 0.2 }],
  }),
  plant({
    sku: 'P-0004',
    name_en: 'Neem (Azadirachta indica)',
    base_name: 'Neem',
    slug: 'neem-native-sapling',
    collection: 'other',
    subcategory: 'Native & medicinal',
    tags: ['Native'],
    plant: { size_class: 'M', canopy: 'medium_tree', propagation: 'seeded', nitrogen_fixer: false, drought_tolerance: 'high' },
    variants: [{ label: 'Seedling', weight_kg: 0.8 }],
  }),
  plant({
    sku: 'P-0005',
    status: 'draft',
    name_en: 'Old Listing Plant',
    slug: 'old-listing-plant',
    collection: 'fruiting',
    subcategory: 'Exotic',
    variants: [{ label: 'Sapling' }],
    seo: { noindex: true },
    provenance: { identity: 'woo' },
    needs_review: true,
    review_notes: ['Keep, publish or delete?'],
    media: { images: [], image_needed: true },
  }),
];

export const seedInputs = [
  {
    sku: 'I-001',
    status: 'active',
    kind: 'input',
    name_en: 'Vermicompost 25 kg',
    slug: 'vermicompost-25-kg',
    collection: 'input',
    subcategory: 'Vermicompost',
    input: { pack_size: 25, unit: 'kg', dosage_rules: [{ basis: 'per_plant', role: 'M', qty: 2, unit: 'kg' }] },
    variants: [{ label: '25 kg bag', weight_kg: 25 }],
    tax: { hsn: '3101', gst_rate: 5, tax_class: 'inputs_5' },
    provenance: { identity: 'placeholder' },
    needs_review: true,
    review_notes: ['Confirm the pack price.'],
  },
];

export const seedFaqs = [
  { key: 'general-001', product_sku: null, question: 'Do you deliver?', answer: 'Yes, to served districts.', source: 'client', status: 'approved', sort: 1 },
  { key: 'general-002', product_sku: 'P-0002', question: 'How long until harvest?', answer: null, source: 'derived', status: 'needs_client', sort: 2 },
];

/** A temp data/seed directory with products.json, inputs.json and faqs.json. */
export async function writeSeedDir(products = seedProducts, inputs = seedInputs, faqs = seedFaqs): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'catalog-seed-'));
  await writeFile(join(dir, 'products.json'), envelope(products));
  await writeFile(join(dir, 'inputs.json'), envelope(inputs));
  await writeFile(join(dir, 'faqs.json'), envelope(faqs));
  return dir;
}

/** Media resolver standing in for the media module: one stable uuid per master path. */
export function fakeMediaIds(): (srcs: readonly string[]) => Promise<Record<string, string>> {
  const ids: Record<string, string> = {
    'products/mango-1.webp': '00000000-0000-7000-8000-000000000001',
    'products/mango-2.webp': '00000000-0000-7000-8000-000000000002',
  };
  return async (srcs) => Object.fromEntries(srcs.flatMap((s) => (ids[s] ? [[s, ids[s]]] : [])));
}

export const fakeImages = async (ids: readonly string[]) =>
  Object.fromEntries(ids.map((id) => [id, { id, src: `/media/${id}.webp`, alt: 'Plant photo', width: 800, height: 800, blurDataURL: null, credit: id.endsWith('2') ? 'A. Photographer, CC BY 4.0' : null }]));
