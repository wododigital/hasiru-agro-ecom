import type { PriceQuote, StockInfo } from '@ecomkit/core/contracts';
import { slugify } from '@ecomkit/core/ids';
import { fakePricing } from '@ecomkit/core/testing/fakes';
import { describe, expect, it } from 'vitest';
import {
  buildProductCard,
  deriveAvailability,
  deriveCollections,
  facetRow,
  fromCsvRow,
  isPurchasable,
  mapSeedProduct,
  matchKey,
  offerAvailability,
  parseRange,
  parseSheetRow,
  productFacts,
  productJsonLdInput,
  seedProductSchema,
  tierAt,
  tierLadder,
  toSheetRow,
  wantsNotify,
  type CardSource,
} from '../src/domain';
import { catalogMessages } from '../src/messages';
import { listingIndexing } from '../src/server/meta';
import { seedProducts } from './fixtures';

const stock = (o: Partial<StockInfo>): StockInfo => ({ variantId: 'v', available: 50, onHand: 50, reserved: 0, availability: 'in_stock', readyInDays: null, lowStock: false, ...o });

describe('availability derivation', () => {
  it('status, override and stock decide the state', () => {
    expect(deriveAvailability({ status: 'draft', override: null, stock: null })).toBe('hidden');
    expect(deriveAvailability({ status: 'active', override: null, deletedAt: new Date(), stock: null })).toBe('hidden');
    expect(deriveAvailability({ status: 'active', override: 'hidden', stock: stock({}) })).toBe('hidden');
    expect(deriveAvailability({ status: 'active', override: 'coming_soon', stock: stock({}) })).toBe('coming_soon');
    expect(deriveAvailability({ status: 'active', override: 'temporarily_unavailable', stock: stock({}) })).toBe('temporarily_unavailable');
    expect(deriveAvailability({ status: 'active', override: 'out_of_stock', stock: stock({}) })).toBe('out_of_stock');
    expect(deriveAvailability({ status: 'active', override: 'available', stock: stock({ availability: 'out_of_stock', available: 0 }) })).toBe('in_stock');
    expect(deriveAvailability({ status: 'active', override: null, stock: null })).toBe('in_stock'); // inventory module off
    expect(deriveAvailability({ status: 'active', override: null, stock: stock({ availability: 'preorder', available: 0 }) })).toBe('preorder');
    expect(deriveAvailability({ status: 'active', override: null, stock: stock({ availability: 'out_of_stock', available: 0 }) })).toBe('out_of_stock');
    expect(deriveAvailability({ status: 'active', override: null, stock: stock({ available: 0 }) })).toBe('out_of_stock');
    expect(deriveAvailability({ status: 'active', override: null, stock: stock({ available: 4, lowStock: true }) })).toBe('low_stock');
    expect(deriveAvailability({ status: 'active', override: null, stock: stock({}) })).toBe('in_stock');
  });

  it('purchasable, notify and schema.org buckets', () => {
    expect(['in_stock', 'low_stock', 'preorder'].every((s) => isPurchasable(s as never))).toBe(true);
    expect(isPurchasable('coming_soon')).toBe(false);
    expect(wantsNotify('out_of_stock') && wantsNotify('coming_soon') && !wantsNotify('preorder')).toBe(true);
    expect([offerAvailability('low_stock'), offerAvailability('coming_soon'), offerAvailability('temporarily_unavailable')]).toEqual(['in_stock', 'preorder', 'out_of_stock']);
  });
});

const source: CardSource = {
  id: 'p1',
  slug: 'alphonso-mango',
  kind: 'plant',
  name: 'Alphonso Mango',
  nameKn: 'ಮಾವು',
  status: 'active',
  availabilityOverride: null,
  collectionName: 'Fruiting',
  subcategory: 'Desi',
  sizeClass: 'L',
  bearingYearsMin: 3,
  bearingYearsMax: 4,
  timberRotationYears: null,
  yieldText: '150 fruits',
  isBestSeller: true,
  publishedAt: new Date('2026-10-10T00:00:00Z'),
  variantId: 'v1',
};
const now = new Date('2026-10-20T10:00:00+05:30');
const quote = async (qty: number) => (await fakePricing({ listPaise: 49_000, tier: { minQty: 50, unitPaise: 35_500 }, compareAtPaise: 70_000 }).getPrice('v1', qty))!;

describe('product card data', () => {
  const ctx = async (o: Partial<Parameters<typeof buildProductCard>[1]> = {}) => ({
    image: null,
    price: await quote(1),
    stock: stock({}),
    reviews: null,
    fit: null,
    extraChips: [],
    cartQty: 0,
    now,
    messages: catalogMessages,
    ...o,
  });

  it('badges follow the priority order and stop at two', async () => {
    const card = buildProductCard(source, await ctx({ fit: 'good', cartQty: 50 }));
    expect(card.badges.map((b) => b.id)).toEqual(['bulk_unlocked', 'fits_district']);
    const out = buildProductCard(source, await ctx({ stock: stock({ availability: 'out_of_stock', available: 0 }) }));
    expect(out.badges.map((b) => b.id)).toEqual(['out_of_stock', 'bestseller']);
    expect(out.purchasable).toBe(false);
    expect(out.notifyMe).toBe(true);
    const plain = buildProductCard({ ...source, isBestSeller: false, publishedAt: new Date('2026-01-01') }, await ctx());
    expect(plain.badges).toEqual([{ id: 'save', label: 'Save Rs 210', tone: 'success' }]);
  });

  it('chips, price, bulk line and stock label', async () => {
    const card = buildProductCard(source, await ctx({ fit: 'ok', stock: stock({ available: 7, lowStock: true }), extraChips: [{ id: 'x', label: 'Extra', tone: 'neutral' }] }));
    expect(card.chips.map((c) => c.label)).toEqual(['Large tree', 'Needs irrigation', 'Fruits in 3 to 4 yrs', 'Extra']);
    expect(card.price).toEqual({ unitPaise: 49_000, compareAtPaise: 70_000 });
    expect(card.bulk).toEqual({ label: 'Rs 355 each from 50 plants', minQty: 50, reached: false });
    expect(card.stockLabel).toBe('Only 7 left');
    expect(card.href).toBe('/plant/alphonso-mango');
    expect(card.collectionLine).toBe('Fruiting · Desi');
    // not_recommended is never shown on a card
    expect(buildProductCard(source, await ctx({ fit: 'not_recommended' })).chips.map((c) => c.id)).not.toContain('fit');
  });

  it('without pricing the card has no price and cannot be bought', async () => {
    const card = buildProductCard(source, await ctx({ price: null }));
    expect(card.price).toBeNull();
    expect(card.bulk).toBeNull();
    expect(card.purchasable).toBe(false);
  });
});

describe('tiers', () => {
  it('walks the pricing ladder and computes the nudge', async () => {
    const pricing = fakePricing({ listPaise: 49_000, tier: { minQty: 50, unitPaise: 35_500 } });
    const ladder = await tierLadder((q) => pricing.getPrice('v1', q));
    expect(ladder).toEqual({ list: { minQty: 1, unitPaise: 49_000 }, tiers: [{ minQty: 50, unitPaise: 35_500 }] });
    expect(tierAt(ladder!.list, ladder!.tiers, 42)).toEqual({ unitPaise: 49_000, next: { minQty: 50, unitPaise: 35_500, more: 8, savePaise: 675_000 } });
    expect(tierAt(ladder!.list, ladder!.tiers, 50)).toEqual({ unitPaise: 35_500, next: null });
  });

  it('stops on a ladder that does not advance', async () => {
    const stuck = async (qty: number): Promise<PriceQuote> => ({ ...(await quote(qty)), nextTier: { minQty: 50, unitPaise: 35_500 as never, qtyToGo: 1 } });
    expect((await tierLadder(stuck))!.tiers).toHaveLength(1);
  });
});

describe('JSON-LD input', () => {
  const base = { name: 'Alphonso Mango', path: '/plant/alphonso-mango', sku: 'P-0001', description: 'Sweet', images: ['/media/a.webp'], listUnitPaise: 49_000, tiers: [{ minQty: 50, unitPaise: 35_500 }], availability: 'in_stock' as const, facts: [{ name: 'Tree size', value: 'Large tree' }], now };
  it('carries offer, bulk price and facts; rating only with enough reviews', () => {
    const input = productJsonLdInput({ ...base, reviews: { productId: 'p1', count: 2, average: 5, showRating: false } });
    expect(input).toEqual({
      name: 'Alphonso Mango',
      path: '/plant/alphonso-mango',
      sku: 'P-0001',
      description: 'Sweet',
      images: ['/media/a.webp'],
      pricePaise: 49_000,
      priceValidUntil: '2027-10-20',
      availability: 'in_stock',
      bulk: { minQty: 50, unitPaise: 35_500 },
      rating: null,
      reviews: [],
      additionalProperties: [{ name: 'Tree size', value: 'Large tree' }],
    });
    expect(productJsonLdInput({ ...base, reviews: { productId: 'p1', count: 5, average: 4.6, showRating: true } })!.rating).toEqual({ average: 4.6, count: 5 });
    expect(productJsonLdInput({ ...base, availability: 'preorder', reviews: null })!.availability).toBe('preorder');
  });
  it('no product node without a price or for a hidden product', () => {
    expect(productJsonLdInput({ ...base, listUnitPaise: null, reviews: null })).toBeNull();
    expect(productJsonLdInput({ ...base, availability: 'hidden', reviews: null })).toBeNull();
  });
});

describe('seed mapping', () => {
  const rec = seedProductSchema.parse(seedProducts[0]);
  it('maps a record to catalog fields without prices or stock', () => {
    const m = mapSeedProduct(rec, slugify);
    expect(m.fields).toMatchObject({ sku: 'P-0001', slug: 'alphonso-mango', name: 'Alphonso Mango', sizeClass: 'L', rainfallMin: 500, bearingYearsMin: 3, bearingYearsMax: 4, matureHeightMaxFt: 40, hsn: '0602', gstRate: 0, weightKg: 3 });
    expect(m.variants).toEqual([{ id: null, label: 'Grafted sapling', skuSuffix: '-01', isDefault: true, heightFt: 2, bagSize: '8x10 in', weightKg: 3, position: 0 }]);
    expect(m.tags.map((t) => t.slug)).toEqual(['medicinal']);
    expect(m.faqs.map((f) => f.status)).toEqual(['published', 'client_only']);
    expect(m.images).toEqual([{ src: 'products/mango-1.webp', role: 'main', position: 0 }, { src: 'products/mango-2.webp', role: 'fruit', position: 1 }]);
  });
  it('derives collections with ampersand-free sub slugs', () => {
    const cols = deriveCollections(seedProducts.map((p) => seedProductSchema.parse(p)), slugify);
    expect(cols.map((c) => `${c.parent ?? ''}/${c.slug}`)).toEqual(['/fruiting', '/timber', '/other', 'fruiting/desi', 'other/biomass-support', 'other/native-medicinal', 'fruiting/exotic']);
  });
  it('parses ranges', () => {
    expect(parseRange('3-4')).toEqual({ min: 3, max: 4 });
    expect(parseRange('5 to 3 years')).toEqual({ min: 3, max: 5 });
    expect(parseRange('6+')).toEqual({ min: 6, max: 6 });
    expect(parseRange('soon')).toEqual({ min: null, max: null });
  });
});

describe('plant data sheet layout', () => {
  const row = [null, 'Mango', 'Alphonso', 'ಮಾವು', 'Large tree', 'Desi fruits', 'Medicinal', null, 'No', 'Moderate', 'Air layered', 27, 15, 38, 60, 30, 85, 500, 2500, '18 x 18', '-', '18 x 18', 12, 5, 5, 8, 10];
  it('parses a row and writes it back identically', () => {
    const r = parseSheetRow(row)!;
    expect(r).toMatchObject({ baseName: 'Mango', variety: 'Alphonso', canopy: 'large_tree', sizeClass: 'L', propagation: 'air_layered', droughtTolerance: 'moderate', spacingFt: { food_forest: [18, 18], miyawaki: null, commercial: [18, 18], boundary: 12 } });
    expect(toSheetRow(r, 0)).toEqual([1, ...row.slice(1)]);
    expect(parseSheetRow([null, '  '])).toBeNull();
  });
  it('match keys fold case and punctuation', () => {
    expect(matchKey('Mango', 'Alphonso')).toBe(matchKey('mango ', 'ALPHONSO'));
    expect(matchKey('Alphonso Mango', null)).toBe('alphonso mango');
  });
});

describe('csv, facets, facts, listing indexing', () => {
  it('csv rows map headers and legacy aliases to fields', () => {
    expect(fromCsvRow({ sku: 'A', soil_tags: 'loam|red', Description: '<p>x</p>' })).toEqual({ sku: 'A', soilTags: ['loam', 'red'], descriptionHtml: '<p>x</p>' });
  });
  it('facet rows use stable codes', () => {
    const row = facetRow({ id: 'p1', kind: 'plant', collectionSlugs: ['desi', 'fruiting'], sizeClass: 'L', propagation: 'grafted', exposure: null, droughtTolerance: 'high', waterNeed: 'low', nitrogenFixer: true, tagSlugs: ['drought-tolerant'], tempMin: 10, tempMax: 40, rainfallMin: 500, rainfallMax: 2000, bearingYearsMin: 3, matureHeightMaxFt: 40, hasYield: true });
    expect(row.facets).toMatchObject({ collection: ['desi', 'fruiting'], size_class: ['L'], exposure: [], nitrogen_fixer: ['yes'], tag: ['drought-tolerant'], yield_known: ['yes'] });
    expect(row.numeric).toEqual({ temp_min: 10, temp_max: 40, rainfall_min: 500, rainfall_max: 2000, bearing_years: 3, height_ft: 40 });
  });
  it('key facts carry units and skip blanks', () => {
    const facts = productFacts(
      { kind: 'plant', scientificName: 'Mangifera indica', sizeClass: 'L', matureHeightMinFt: 30, matureHeightMaxFt: 40, bearingYearsMin: 3, bearingYearsMax: 4, timberRotationYears: null, attributes: {}, yieldText: null, harvestSeason: null, exposure: 'full_sun', waterNeed: null, droughtTolerance: 'moderate', tempMin: 15, tempMax: 38, rainfallMin: 500, rainfallMax: 2500, propagation: 'grafted', nitrogenFixer: false, spacingFt: { food_forest: [18, 18], boundary: 12 }, heightAtDispatchFt: 2, bagSize: null, packSize: null },
      catalogMessages,
    );
    expect(Object.fromEntries(facts.map((f) => [f.name, f.value]))).toEqual({
      'Scientific name': 'Mangifera indica',
      'Tree size': 'Large tree',
      'Mature height': '30 to 40 ft',
      'Starts fruiting': '3 to 4 yrs',
      Sunlight: 'Full sun',
      'Drought tolerance': 'Moderate',
      'Temperature range': '15 to 38 °C',
      Rainfall: '500 to 2500 mm a year',
      Propagation: 'Grafted',
      Spacing: 'Food forest 18 x 18 ft, Boundary 12 ft',
      'Height at dispatch': '2 ft',
    });
  });
  it('listing pages: page alone keeps a self canonical, any other query is noindex', () => {
    expect(listingIndexing({})).toEqual({ page: 1, noindex: false });
    expect(listingIndexing({ page: '3' })).toEqual({ page: 3, noindex: false });
    expect(listingIndexing({ page: '2', sort: 'name' })).toEqual({ page: 2, noindex: true });
    expect(listingIndexing({ page: 'x' })).toEqual({ page: 1, noindex: false });
  });
});

describe('copy rules', () => {
  it('default messages have no em dashes or release words', () => {
    const text = JSON.stringify(catalogMessages, (_, v) => (typeof v === 'function' ? v(1, 2, 3).toString() : v));
    expect(text).not.toMatch(/—|–/);
    expect(text).not.toMatch(/\b(phase|v1|v2)\b/i);
  });
});
