// The gap-fill rules and the matcher, against the real client workbook and Woo export.
import { describe, expect, it } from 'vitest';
import { cleanText, roundBulk } from '../seed/lib/common';
import { imageSize } from '../seed/lib/image-size';
import { readWorkbook, sheetByName } from '../seed/lib/xlsx';
import { buildProducts, defaultRole, seoTitle, wpSlug, wooShort } from '../seed/fill-gaps';
import { buildFaqs, tidyQuestion } from '../seed/faqs';
import { AGARWOOD_SKU, matchPlants, PINS, species, tokens, wooPlants } from '../seed/match-woo';
import { buildModels } from '../seed/models';
import { binomial, normalizePlants, parseSpacing, researchRows } from '../seed/normalize-plants';
import { paths } from '../seed/lib/common';

describe('xlsx reader', () => {
  it('reads the client workbook: tabs, header and the first and last Plant data rows', () => {
    const book = readWorkbook(paths.xlsx());
    expect([...book.keys()].map((k) => k.trim())).toEqual(['Plant list', 'Plant data', 'FAQs', 'Dis-wise Geo data', 'General questions', 'Nursery questions', 'Farmer questions']);
    const sheet = sheetByName(book, 'Plant data');
    expect(sheet.get(4)!.slice(1, 6)).toEqual(['Amla', null, 'ನೆಲ್ಲಿಕಾಯಿ', 'Large tree', 'Desi fruits']);
    expect(sheet.get(4)![19]).toBe('18 x 18');
    expect(sheet.get(162)![1]).toBe('Mulberry');
    expect(sheet.get(163)?.[1] ?? null).toBeNull();
  });
});

describe('normalize-plants', () => {
  const rows = normalizePlants();
  it('keeps all 159 rows, 55 of them native saplings, with sizes and collections as researched', () => {
    expect(rows).toHaveLength(159);
    expect(rows.filter((r) => r.is_native)).toHaveLength(55);
    for (const r of rows) {
      expect([r.size_class, r.collection, r.subcategory], `row ${r.source_row}`).toEqual([r.research.size, r.research.collection, r.research.subcategory]);
    }
  });
  it('fixes typos and keeps the originals searchable', () => {
    const alphonso = rows.find((r) => r.source_row === 30)!;
    expect(alphonso.variety).toBe('Alphonso');
    expect(alphonso.search_aliases).toContain('Mango Alphonoso');
    expect(rows.find((r) => r.source_row === 63)!.name_en).toBe('Biriba');
    expect(rows.find((r) => r.source_row === 93)!.base_name).toBe('Mahogany');
  });
  it('names native rows "Common (Scientific)" with a -native-sapling slug', () => {
    const s = rows.find((r) => r.source_row === 141)!;
    expect(s.name_en).toBe('Native Sandalwood (Santalum album)');
    expect(s.slug_base).toBe('Sandalwood native sapling');
    expect(rows.find((r) => r.source_row === 135)!.name_en).toBe('Malabar Neem (Melia dubia)');
  });
  it('parses spacing, "-" and blanks', () => {
    expect(parseSpacing('18 x 18')).toEqual([18, 18]);
    expect(parseSpacing('-')).toBeNull();
    expect(parseSpacing(null)).toBeNull();
    expect(() => parseSpacing('eighteen')).toThrow();
    expect(rows.find((r) => r.source_row === 48)!.spacing.boundary).toBeNull(); // blank Pomegranate boundary
    expect(binomial('Madhuca longifolia var. latifolia (Roxb.) A.Chev.')).toBe('Madhuca longifolia var. latifolia');
  });
});

describe('match-woo', () => {
  it('finds the species by the phrase that ends last', () => {
    expect(species(tokens('Thai Banana mango'))).toBe('mango');
    expect(species(tokens('Banana Sapota'))).toBe('chikku');
    expect(species(tokens('Apple Ber Plant'))).toBe('ber');
    expect(species(tokens('Red Sandalwood'))).toBe('red_sandal');
    expect(species(tokens('Mangosteen (1.5ft)'))).toBe('mangosteen');
  });
  it('matches 65 exact, 15 sibling, 24 none and never matches the 55 native rows; agrees with the research review', () => {
    const m = matchPlants();
    const rows = normalizePlants();
    const kinds = rows.map((r) => (r.is_native ? 'native' : m.get(r.source_row)!.kind));
    expect(kinds.filter((k) => k === 'exact')).toHaveLength(65);
    expect(kinds.filter((k) => k === 'sibling')).toHaveLength(15);
    expect(kinds.filter((k) => k === 'none')).toHaveLength(24);
    expect(kinds.filter((k) => k === 'native')).toHaveLength(55);
    for (const r of rows) {
      const got = m.get(r.source_row)!;
      expect([got.kind, got.woo_sku], `row ${r.source_row} ${r.name_en}`).toEqual([r.research.match, r.research.match === 'none' ? null : r.research.woo_sku]);
    }
  });
  it('pins only rows where the scoring disagrees (no dead pins)', () => {
    const m = matchPlants();
    for (const row of Object.keys(PINS).map(Number)) {
      const x = m.get(row)!;
      expect([x.suggested.kind, x.suggested.woo_sku], `pin on row ${row} is redundant`).not.toEqual([x.kind, x.woo_sku]);
    }
  });
  it('drops the e-book and keeps 193 Woo plants', () => {
    expect(wooPlants()).toHaveLength(193);
    expect(wooPlants().some((w) => w.SKU === AGARWOOD_SKU)).toBe(true);
  });
});

describe('fill-gaps rules', () => {
  const { products } = buildProducts();
  const bySku = new Map(products.map((p) => [p.sku, p]));
  it('rounds bulk prices to Rs 5 from Rs 100, to the rupee below', () => {
    expect([60, 120, 140, 490, 1960].map((p) => roundBulk(p * 0.72))).toEqual([43, 86, 100, 355, 1410]);
  });
  it('fills prices exactly as the research appendix (Woo sale, sibling sale, researched, native band)', () => {
    const research = new Map(researchRows().map((r) => [r.row ?? 'extra', r]));
    for (const p of products.filter((x) => x.source_row)) {
      const r = research.get(p.source_row!)!;
      const v = p.variants[0]!;
      expect([v.price, v.bulk_price, v.bulk_min_qty], p.name_en).toEqual([r.price, r.bulk, r.bulk_min_qty]);
      expect(p.provenance.price, p.name_en).toBe(r.price_source);
    }
    const agarwood = products.find((p) => p.data_source === 'woo_extra')!;
    expect(agarwood.variants[0]!.price).toBe(research.get('extra')!.price);
  });
  it('sets compare-at only from a real old price on exact matches', () => {
    for (const p of products) {
      for (const v of p.variants) if (v.compare_at_price !== null) expect(p.match?.kind, p.name_en).toBe('exact');
    }
    expect(bySku.get('HAP-0027')!.variants[0]!.compare_at_price).toBe(700);
    expect(bySku.get('HAP-0002')!.variants[0]!.compare_at_price).toBeNull(); // sibling
  });
  it('applies weights, packing, stock and the two size variants', () => {
    const native = products.find((p) => p.source_row === 141)!;
    expect(native.variants[0]!.weight_kg).toBe(0.8);
    expect(products.find((p) => p.source_row === 158)!.variants[0]!.weight_kg).toBe(0.2); // lemongrass slip at Rs 10
    const mango = bySku.get('HAP-0027')!.variants[0]!;
    expect([mango.weight_kg, mango.packing_fee, mango.stock_qty, mango.availability]).toEqual([3, 15, 168, 'in_stock']);
    const unmatched = products.find((p) => p.source_row === 37)!.variants[0]!;
    expect([unmatched.availability, unmatched.ready_in_days]).toEqual(['preorder', 30]);
    const mangosteen = products.find((p) => p.source_row === 75)!;
    expect(mangosteen.variants.map((v) => [v.label, v.price])).toEqual([['1.5 ft', 630], ['6 ft', 1525]]);
    const rambutan = products.find((p) => p.source_row === 83)!;
    expect(rambutan.variants.map((v) => [v.label, v.price])).toEqual([['3 ft', 770], ['8 ft', 3640]]);
  });
  it('imports Agarwood live and 125 Woo-only plants as noindex drafts', () => {
    const legacy = products.filter((p) => p.data_source === 'woo_legacy');
    expect(legacy).toHaveLength(125);
    expect(legacy.every((p) => p.status === 'draft' && p.seo.noindex)).toBe(true);
    const agarwood = products.find((p) => p.data_source === 'woo_extra')!;
    expect([agarwood.sku, agarwood.status, agarwood.legacy_sku]).toEqual(['HAP-0160', 'active', AGARWOOD_SKU]);
  });
  it('defaults roles per A12 and marks the model provenance as placeholder', () => {
    expect(defaultRole({ size_class: 'L', subcategory: 'Desi', tags: [] })).toBe('M');
    expect(defaultRole({ size_class: 'M', subcategory: 'Timber', tags: [] })).toBe('X');
    expect(defaultRole({ size_class: 'M', subcategory: 'Biomass & support', tags: [] })).toBe('O');
    expect(defaultRole({ size_class: 'S', subcategory: 'Spices', tags: [] })).toBe('O');
    expect(bySku.get('HAP-0027')!.provenance.models).toBe('placeholder');
  });
  it('writes copy without dashes, labels or scaffolding, and SEO titles within 60 characters when generated', () => {
    expect(cleanText('grows 7–10 m — fast\r\\nnext')).toBe('grows 7 to 10 m, fast\nnext');
    expect(wooShort('Product Title: "X Duo"\n\nShort Description:\n\n"Great!" Grow it.')).toBe('"Great!" Grow it.');
    expect(seoTitle('Alphonso Mango', null)).toBe('Buy Alphonso Mango Plant Online in Bengaluru | Hasiru Agro');
    expect(seoTitle('Ankola (Alangium salviifolium)', null).length).toBeLessThanOrEqual(60);
    expect(seoTitle('X', 'Buy %title% %sep% %sitename%')).toMatch(/^Buy X Plant/);
    expect(wpSlug("Buddha's hand lime")).toBe('buddhas-hand-lime');
  });
  it('flags every non-Woo price, template copy and missing photo for review', () => {
    for (const p of products.filter((x) => x.data_source === 'client')) {
      if (p.provenance.price !== 'woo' || p.content.status === 'ai_draft' || p.media.image_needed) expect(p.needs_review, p.name_en).toBe(true);
    }
    expect(products.filter((p) => p.status === 'active' && p.media.image_needed).every((p) => p.review_notes.some((n) => /No photo/.test(n)))).toBe(true);
  });
});

describe('models and faqs', () => {
  it('builds the four models with members from the client spacing', () => {
    const models = buildModels();
    expect(models.map((m) => [m.slug, m.members.length])).toEqual([['boundary', 92], ['commercial', 95], ['food-forest', 86], ['miyawaki', 76]]);
    const miyawaki = models.find((m) => m.slug === 'miyawaki')!;
    expect([miyawaki.mix, miyawaki.rng_seed, miyawaki.weight_override_kg]).toEqual([{ M: 0.1, X: 0.5, O: 0.4 }, 42, 0.8]);
  });
  it('has the 36 customer-facing general questions, answers only from data, competitor name removed', () => {
    const faqs = buildFaqs();
    const general = faqs.filter((f) => !f.product_sku);
    expect(general).toHaveLength(36);
    expect(faqs.every((f) => (f.status === 'approved') === (f.answer !== null && f.source === 'derived') || f.status === 'draft')).toBe(true);
    expect(JSON.stringify(faqs)).not.toMatch(/sapling ?mart/i);
    expect(tidyQuestion('What is the scope of the plant in 10yrs')).toBe('What is the scope of the plant in 10 years?');
  });
});

describe('image-size', () => {
  it('reads PNG and rejects junk', () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d494844520000002a0000001b0806000000', 'hex');
    expect(imageSize(png)).toEqual({ w: 42, h: 27 });
    expect(() => imageSize(Buffer.from('not an image at all'))).toThrow();
  });
});
