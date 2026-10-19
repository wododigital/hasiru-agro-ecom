// Step 9.4: the seven input products from the HANDOFF sample (research section 7). Every value is a
// placeholder until the client sends real products, prices and dosage formulas.
import { join } from 'node:path';
import type { SeedContext } from '../../../packages/core/src/contracts/extensions';
import { once, slugify, SOURCES, writeSeedFile } from './lib/common';
import { type InputBlock, PREORDER_DAYS, type ProductRecord } from './fill-gaps';

interface InputSpec {
  name: string;
  subcategory: string;
  input_type: string;
  pack_size: number;
  unit: InputBlock['unit'];
  pack_weight_kg: number;
  price: number;
  hsn: string;
  gst_rate: number;
  tax_class: string;
  needs_ca_confirmation: boolean;
  dosage: InputBlock['dosage_rules'];
  recommended_with: string[];
  short: string;
  notes: string[];
}

/** Variant label from the short description's last sentence ("25 kg bag."). */
const packLabel = (short: string) => short.split('. ').at(-1)!.replace(/\.$/, '');

const perRole = (vermi: [number, number, number]): InputBlock['dosage_rules'] =>
  (['M', 'X', 'O'] as const).map((role, i) => ({ basis: 'per_plant', model: null, role, size_class: null, qty: vermi[i]!, unit: 'kg' }));

export const INPUT_SPECS: InputSpec[] = [
  {
    name: 'Vermicompost', subcategory: 'Vermicompost', input_type: 'vermicompost', pack_size: 25, unit: 'kg', pack_weight_kg: 25, price: 450,
    hsn: '3101', gst_rate: 5, tax_class: 'inputs_5', needs_ca_confirmation: false, dosage: perRole([2, 1, 0.5]),
    recommended_with: ['commercial', 'food-forest', 'miyawaki', 'boundary'],
    short: 'Packed vermicompost for planting pits and yearly feeding. 25 kg bag.',
    notes: ['Packed and branded compost is 5% GST (loose and unbranded is nil); confirm with the CA.'],
  },
  {
    name: 'Biochar', subcategory: 'Biochar', input_type: 'biochar', pack_size: 10, unit: 'kg', pack_weight_kg: 10, price: 600,
    hsn: '3101', gst_rate: 5, tax_class: 'inputs_5', needs_ca_confirmation: true, dosage: perRole([1, 0.5, 0.25]),
    recommended_with: ['commercial', 'food-forest', 'miyawaki', 'boundary'],
    short: 'Biochar to mix into planting pits; holds water and nutrients in the root zone. 10 kg bag.',
    notes: ['HSN 3101 or 4402 for biochar; confirm with the CA.'],
  },
  {
    name: 'Farm Compost', subcategory: 'Compost', input_type: 'compost', pack_size: 50, unit: 'kg', pack_weight_kg: 50, price: 400,
    hsn: '3101', gst_rate: 5, tax_class: 'inputs_5', needs_ca_confirmation: false,
    dosage: [{ basis: 'per_plant', model: null, role: null, size_class: null, qty: 1, unit: 'kg', note: "uses each plant's compost_kg.at_planting from the client data" }],
    recommended_with: ['commercial', 'food-forest', 'miyawaki', 'boundary'],
    short: 'Well-rotted farm compost for planting and yearly feeding. 50 kg bag.',
    notes: [],
  },
  {
    name: 'Neem Cake', subcategory: 'Compost', input_type: 'neem_cake', pack_size: 25, unit: 'kg', pack_weight_kg: 25, price: 900,
    hsn: '2306', gst_rate: 5, tax_class: 'inputs_5', needs_ca_confirmation: true,
    dosage: [{ basis: 'per_plant', model: null, role: null, size_class: null, qty: 0.25, unit: 'kg' }],
    recommended_with: ['commercial', 'food-forest'],
    short: 'Neem cake for soil application around the root zone. 25 kg bag.',
    notes: ['Neem cake HSN 2306 and GST rate; confirm with the CA.'],
  },
  {
    name: 'Jeevamrutha Liquid', subcategory: 'Liquid fertiliser', input_type: 'liquid_fertiliser', pack_size: 5, unit: 'L', pack_weight_kg: 5.5, price: 250,
    hsn: '3101', gst_rate: 5, tax_class: 'inputs_5', needs_ca_confirmation: true,
    dosage: [{ basis: 'per_acre', model: null, role: null, size_class: null, qty: 4, unit: 'L' }],
    recommended_with: ['commercial', 'food-forest'],
    short: 'Ready-to-dilute Jeevamrutha for soil drenching. 5 L can.',
    notes: ['GST rate for liquid organic fertiliser; confirm with the CA.'],
  },
  {
    name: 'Neem Oil Bio-pesticide', subcategory: 'Bio-pesticide', input_type: 'bio_pesticide', pack_size: 1, unit: 'L', pack_weight_kg: 1.1, price: 350,
    hsn: '3808', gst_rate: 18, tax_class: 'inputs_18', needs_ca_confirmation: true,
    dosage: [{ basis: 'per_acre', model: null, role: null, size_class: null, qty: 1, unit: 'L', note: 'spray, dilution as per label' }],
    recommended_with: ['commercial', 'food-forest'],
    short: 'Neem oil spray for natural pest control. 1 L bottle.',
    notes: ['HANDOFF says 18% GST; the rate was reportedly cut in the Sept 2025 GST rationalisation. CA to confirm.'],
  },
  {
    name: 'Green Manure Seed Mix', subcategory: 'Seeds', input_type: 'seeds', pack_size: 1, unit: 'kg', pack_weight_kg: 1, price: 180,
    hsn: '1209', gst_rate: 0, tax_class: 'seeds_nil', needs_ca_confirmation: false,
    dosage: [
      { basis: 'per_acre', model: null, role: null, size_class: null, qty: 10, unit: 'kg' },
      { basis: 'per_block', model: null, role: null, size_class: null, qty: 0.3, unit: 'kg', note: '36 x 36 ft block, from 10 kg per acre' },
    ],
    recommended_with: ['commercial', 'food-forest', 'boundary'],
    short: 'Seed mix for a green-manure cover crop between rows. 1 kg pack.',
    notes: ['Green-manure seed rate of 10 kg per acre is a placeholder.'],
  },
];

export const buildInputs = once((): ProductRecord[] =>
  INPUT_SPECS.map((s, i) => {
    const sku = `HAI-${String(i + 1).padStart(3, '0')}`;
    const slug = slugify(s.name);
    return {
      sku,
      legacy_sku: null,
      legacy_woo_id: null,
      ops_item_id: null,
      source_row: null,
      status: 'active',
      kind: 'input',
      data_source: 'placeholder',
      name_en: s.name,
      base_name: s.name,
      variety: null,
      name_kn: null,
      scientific_name: null,
      search_aliases: [],
      slug,
      collection: 'input',
      subcategory: s.subcategory,
      tags: [s.input_type],
      is_priority: false,
      is_best_seller: false,
      is_featured: false,
      sourcing: null,
      has_video: { whatsapp: false, youtube: false },
      plant: null,
      input: { pack_size: s.pack_size, unit: s.unit, pack_weight_kg: s.pack_weight_kg, input_type: s.input_type, dosage_rules: s.dosage, recommended_with: s.recommended_with },
      variants: [
        {
          sku: `${sku}-01`,
          label: packLabel(s.short),
          height_at_dispatch_ft: null,
          bag_size: null,
          price: s.price,
          compare_at_price: null,
          // bulk pricing is off for inputs by default: same price at any quantity
          bulk_price: s.price,
          bulk_min_qty: 1,
          offline_price: null,
          cost_price: null,
          weight_kg: s.pack_weight_kg,
          packing_fee: 0,
          stock_qty: 0,
          availability: 'preorder',
          ready_in_days: PREORDER_DAYS,
          low_stock_threshold: 10,
        },
      ],
      tax: { hsn: s.hsn, gst_rate: s.gst_rate, tax_class: s.tax_class, ...(s.needs_ca_confirmation ? { needs_ca_confirmation: true } : {}) },
      content: { short_description: s.short, description_html: null, status: 'ai_draft', faqs: [] },
      media: { images: [], videos: [], image_needed: true },
      seo: {
        title: `Buy ${s.name} Online | Hasiru Agro`,
        description: s.short,
        focus_keyword: null,
        noindex: false,
        legacy_urls: [],
        google_product_category: 'Home & Garden > Lawn & Garden > Gardening > Fertilizers',
        identifier_exists: false,
      },
      provenance: { identity: 'placeholder', climate: null, models: null, compost: null, attributes: 'placeholder', price: 'placeholder', stock: 'placeholder', content: 'ai_draft', images: 'placeholder', seo: 'derived' },
      match: null,
      needs_review: true,
      review_notes: ['Sample input product from the prototype (name, pack, price, dosage are placeholders); client to confirm.', ...s.notes],
    };
  }),
);

export default async function step(ctx: SeedContext): Promise<void> {
  const records = buildInputs();
  writeSeedFile(join(ctx.seedDir, 'inputs.json'), [SOURCES.handoff, SOURCES.research], records, ctx);
  ctx.log.info(`inputs: ${records.length} placeholder input products`);
}
