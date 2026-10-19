import { randomBytes } from 'node:crypto';
import type { JsonLdBuilders, JsonLdNode } from '@ecomkit/core/contracts';
import { createTestDb, type TestDb } from '@ecomkit/core/testing';
import { fakeFit, fakeInventory, fakePricing, fakeReviews } from '@ecomkit/core/testing/fakes';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn() }));

import { ProductEditPage } from '../src/admin/ProductEditor';
import PlantPage, { generateMetadata as plantMetadata } from '../src/routes/plant';
import InputPage from '../src/routes/input';
import PlantsPage, { generateMetadata as plantsMetadata } from '../src/routes/plants';
import CollectionPage from '../src/routes/plants-collection';
import SubCollectionPage from '../src/routes/plants-sub';
import { catalogProduct } from '../src/schema';
import { importSeed, rowToFields } from '../src/server/import';
import { configureCatalog, type CatalogRuntimeInput } from '../src/server/runtime';
import { saveProduct } from '../src/server/write';
import { loadProductOr404 } from '../src/ui/ProductPage';
import { fakeImages, fakeMediaIds, writeSeedDir } from './fixtures';
import { fakeRegistry, renderHtml, signInAs, STAFF } from './helpers';

let t: TestDb;
let mangoVariant: string;
let mangoId: string;

/** Minimal builders standing in for the seo module (shape only; escaping as the contract says). */
const jsonLd: JsonLdBuilders = {
  organization: () => ({ '@type': 'Organization' }),
  website: () => ({ '@type': 'WebSite' }),
  localBusiness: () => ({ '@type': 'LocalBusiness' }),
  product: (i) => ({ '@type': 'Product', name: i.name, sku: i.sku, offers: { '@type': 'Offer', price: i.pricePaise / 100, availability: i.availability, bulk: i.bulk }, aggregateRating: i.rating }),
  breadcrumbs: (items) => ({ '@type': 'BreadcrumbList', itemListElement: items }),
  faqPage: (items) => ({ '@type': 'FAQPage', mainEntity: items }),
  collectionPage: (i) => ({ '@type': 'CollectionPage', name: i.name, items: i.items }),
  article: () => ({ '@type': 'Article' }),
  videoObject: () => ({ '@type': 'VideoObject' }),
  graph: (nodes: readonly JsonLdNode[]) => JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes }).replace(/</g, '\\u003c'),
};

function bind(o: { district?: string | null; stock?: 'in_stock' | 'out_of_stock'; extra?: Partial<CatalogRuntimeInput> } = {}) {
  configureCatalog({
    images: fakeImages,
    jsonLd,
    readDistrict: async () => o.district ?? null,
    registry: fakeRegistry({
      modules: ['cart', 'planting', 'pricing', 'inventory', 'reviews', 'places'],
      services: {
        pricing: fakePricing({ listPaise: 49_000, tier: { minQty: 50, unitPaise: 35_500 }, compareAtPaise: 70_000 }),
        inventory: fakeInventory({ [mangoVariant]: o.stock ?? 'in_stock' }),
        reviews: fakeReviews({ approved: 5 }),
        places: fakeFit(),
      },
      lists: {
        pdpSections: [{ id: 'delivery', order: 1, slot: 'below', moduleId: 'shipping', component: async () => ({ productId }: { productId: string }) => <p data-section="delivery">{`delivery check for ${productId}`}</p> }],
      },
    }),
    ...o.extra,
  });
}

const render = (slug = 'alphonso-mango') => renderHtml(<PlantPage params={Promise.resolve({ slug })} />);

beforeAll(async () => {
  process.env.INTERNAL_SECRET = 'z'.repeat(40);
  process.env.SETTINGS_MASTER_KEY = `1:${randomBytes(32).toString('base64')}`;
  t = await createTestDb('wp-04-pages', { schemas: ['core', 'catalog'] });
  configureCatalog({ resolveMediaIds: fakeMediaIds() });
  await importSeed({ seedDir: await writeSeedDir() });
  const [mango] = await t.db.select().from(catalogProduct).where(eq(catalogProduct.sku, 'P-0001'));
  mangoId = mango!.id;
  const { listProducts } = await import('../src/server/queries');
  mangoVariant = (await listProducts({ ids: [mangoId] })).rows[0]!.variantId!;
});

afterAll(async () => {
  await t?.close();
});

describe('product page against the core fakes', () => {
  it.each([
    ['bengaluru-urban', 'good', 'Grows well in Bengaluru Urban'],
    ['mysuru', 'ok', 'Grows in Mysuru with irrigation'],
    ['ballari', 'not_recommended', 'Not recommended for Ballari'],
  ])('district %s renders the %s fit panel', async (district, level, text) => {
    bind({ district });
    const html = await render();
    expect(html).toContain(`data-fit="${level}"`);
    expect(html).toContain(text);
    if (level !== 'good') expect(html).toMatch(/Regular watering helps it establish|The local climate is outside its range/);
  });

  it('without a district the panel asks for one and links to the planner', async () => {
    bind({ district: null });
    const html = await render();
    expect(html).toContain('data-fit="unknown"');
    expect(html).toContain('data-cta="pdp-fit-choose-district"');
  });

  it('in stock: price, bulk tiers and nudge, buy buttons, sections, JSON-LD, published FAQs only', async () => {
    bind({ district: 'bengaluru-urban', stock: 'in_stock' });
    const html = await render();
    expect(html).toContain('data-availability="in_stock"');
    expect(html).toContain('<h1');
    expect(html).toContain('Alphonso Mango');
    expect(html).toContain('ಮಾವು');
    expect(html).toContain('Rs 490');
    expect(html).toContain('50+ plants');
    expect(html).toContain('Rs 355');
    expect(html).toContain('Add 49 more to unlock Rs 355 each, save Rs 6,750');
    expect(html).toContain('data-cta="pdp-add-to-cart"');
    expect(html).toContain('data-cta="pdp-buy-now"');
    expect(html).not.toContain('id="notify"');
    expect(html).toContain(`delivery check for ${mangoId}`);
    expect(html).toContain('When does it fruit?');
    expect(html).not.toContain('Do I need a permit?');
    expect(html).toContain('Photo: A. Photographer, CC BY 4.0');
    expect(html).toContain('Mangifera indica');
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)![1]!) as { '@graph': { '@type': string; offers?: unknown; aggregateRating?: unknown }[] };
    expect(ld['@graph'].map((n) => n['@type'])).toEqual(['Product', 'BreadcrumbList', 'FAQPage']);
    expect(ld['@graph'][0]).toMatchObject({ offers: { price: 490, availability: 'in_stock', bulk: { minQty: 50, unitPaise: 35_500 } }, aggregateRating: { average: 4.6, count: 5 } });
  });

  it('out of stock: no buy buttons, the notify form instead, schema availability follows', async () => {
    bind({ district: 'bengaluru-urban', stock: 'out_of_stock' });
    const html = await render();
    expect(html).toContain('data-availability="out_of_stock"');
    expect(html).toContain('id="notify"');
    expect(html).toContain('action="/api/notify-me"');
    expect(html).not.toContain('data-cta="pdp-add-to-cart"');
    expect(html).toContain('"availability":"out_of_stock"');
  });

  it('with every optional module off the page still renders (no price, no fit, no JSON-LD)', async () => {
    configureCatalog({});
    const html = await render();
    expect(html).toContain('Alphonso Mango');
    expect(html).not.toContain('data-cta="pdp-add-to-cart"');
    expect(html).not.toContain('application/ld+json');
    expect(html).not.toContain('data-fit');
  });

  it('an old slug answers with a permanent redirect; unknown, draft and wrong-kind slugs 404', async () => {
    bind();
    const p = (await t.db.select().from(catalogProduct).where(eq(catalogProduct.sku, 'P-0002')))[0]!;
    await saveProduct({ id: p.id, fields: { ...rowToFields(p), slug: 'teak-sapling' }, variants: [] }, { actorId: null, actorType: 'system' });
    await expect(loadProductOr404('teak', 'plant')).rejects.toMatchObject({ digest: expect.stringMatching(/^NEXT_REDIRECT;replace;\/plant\/teak-sapling;308;/) });
    for (const [slug, kind] of [['nope', 'plant'], ['old-listing-plant', 'plant'], ['alphonso-mango', 'input']] as const) {
      await expect(loadProductOr404(slug, kind)).rejects.toMatchObject({ digest: expect.stringContaining('404') });
    }
    expect(await renderHtml(<InputPage params={Promise.resolve({ slug: 'vermicompost-25-kg' })} />)).toContain('Pack size');
  });

  it('metadata uses the product SEO fields', async () => {
    bind();
    expect(await plantMetadata({ params: Promise.resolve({ slug: 'alphonso-mango' }) })).toMatchObject({ title: 'Buy Alphonso Mango sapling', alternates: { canonical: '/plant/alphonso-mango' }, robots: undefined });
  });
});

describe('listing pages', () => {
  it('/plants: tabs with live counts, Help me choose CTA, cards', async () => {
    bind();
    const html = await renderHtml(<PlantsPage searchParams={Promise.resolve({})} />);
    expect(html).toContain('data-cta="plants-help-me-choose"');
    expect(html).toMatch(/href="\/plants\/fruiting".*?Fruiting.*?>1</s);
    expect(html).toContain('href="/plant/alphonso-mango"');
    expect(html).toContain('data-cta="card-add-to-cart"');
    expect(html).not.toContain('Old Listing Plant');
    expect(await plantsMetadata({ searchParams: Promise.resolve({ sort: 'name' }) })).toMatchObject({ robots: { index: false, follow: true }, alternates: { canonical: '/plants' } });
  });

  it('a collection shows its sub-collections; a sub-collection lists only its products', async () => {
    bind();
    const html = await renderHtml(<CollectionPage params={Promise.resolve({ collection: 'other' })} searchParams={Promise.resolve({})} />);
    expect(html).toContain('href="/plants/other/biomass-support"');
    expect(html).toContain('href="/plants/other/native-medicinal"');
    expect(html).toContain('Gliricidia');
    const sub = await renderHtml(<SubCollectionPage params={Promise.resolve({ collection: 'other', sub: 'biomass-support' })} searchParams={Promise.resolve({})} />);
    expect(sub).toContain('Gliricidia');
    expect(sub).not.toContain('Neem');
    await expect(renderHtml(<SubCollectionPage params={Promise.resolve({ collection: 'fruiting', sub: 'biomass-support' })} searchParams={Promise.resolve({})} />)).rejects.toMatchObject({ digest: expect.stringContaining('404') });
  });

  it('trait tags are curated pages; other tags and unknown slugs 404', async () => {
    bind();
    const html = await renderHtml(<CollectionPage params={Promise.resolve({ collection: 'nitrogen-fixing' })} searchParams={Promise.resolve({})} />);
    expect(html).toContain('Gliricidia');
    expect(html).toContain('"@type":"CollectionPage"');
    for (const slug of ['medicinal', 'nothing-here']) {
      await expect(renderHtml(<CollectionPage params={Promise.resolve({ collection: slug })} searchParams={Promise.resolve({})} />)).rejects.toMatchObject({ digest: expect.stringContaining('404') });
    }
  });

  it('price sort and pagination are server-rendered for crawlers', async () => {
    bind();
    const html = await renderHtml(<PlantsPage searchParams={Promise.resolve({ sort: 'price_desc', page: '1' })} />);
    expect(html).toContain('<option value="price_desc" selected="">');
  });
});

describe('admin product form', () => {
  it('hosts productFormTabs from other modules, filtered by permission', async () => {
    signInAs(STAFF);
    bind({
      extra: {
        registry: fakeRegistry({
          lists: {
            productFormTabs: [
              { id: 'pricing', label: 'Pricing', order: 1, moduleId: 'fixture', permission: 'pricing.write', component: async () => ({ productId }: { productId: string | null }) => <p>{`pricing tab for ${productId}`}</p> },
              { id: 'secret', label: 'Secret', order: 2, moduleId: 'fixture', permission: 'settings.secrets', component: async () => () => <p>secret tab</p> },
            ],
          },
        }),
      },
    });
    const html = await renderHtml(await ProductEditPage({ id: mangoId }));
    expect(html).toContain('Plant data');
    expect(html).toContain('Pricing');
    expect(html).toContain(`pricing tab for ${mangoId}`);
    expect(html).toContain('data-injected-tab="pricing"');
    expect(html).not.toContain('secret tab');
    expect(html).toContain('name="_fields"');
  });

  it('non-staff cannot open it', async () => {
    signInAs({ kind: 'guest' });
    await expect(ProductEditPage({ id: mangoId })).rejects.toThrow(/forbidden/);
  });
});
