import type { JsonLdNode, ProductJsonLdInput } from '@ecomkit/core/contracts';
import type { Metadata } from 'next';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AI_CRAWLERS,
  canonicalUrl,
  createJsonLd,
  escapeJsonLd,
  llmsTxt,
  metadataFor,
  normalisePath,
  planRedirect,
  robotsTxt,
  siteIdentity,
  sitemapIndexXml,
  sitemapUrls,
  urlsetXml,
} from '../src/domain';

const site = siteIdentity({
  url: 'https://www.example.com/',
  name: 'Example Store',
  description: 'Plants and garden inputs.',
  logo: '/logo.png',
  sameAs: ['https://instagram.com/example'],
  phone: '+919876543210',
  businessType: 'GardenStore',
  address: { streetAddress: '1 Main Road', addressLocality: 'Townsville', addressRegion: 'Karnataka', postalCode: '560001' },
  geo: { latitude: 12.97, longitude: 77.59 },
  openingHours: ['Mo-Sa 08:00-18:00'],
  searchPath: '/search',
  returnPolicy: { category: 'not_permitted' },
});

describe('paths and canonical rules', () => {
  it('normalises request paths', () => {
    expect(normalisePath('/Plants/Fruiting-Trees/')).toBe('/plants/fruiting-trees');
    expect(normalisePath('/plants?f=1#x')).toBe('/plants');
    expect(normalisePath('https://old.example.com/Product/Mango/')).toBe('/product/mango');
    expect(normalisePath('/caf%c3%a9')).toBe('/caf%C3%A9');
    expect(normalisePath('/og/Plant/X')).toBe('/og/Plant/X');
    expect(normalisePath('/')).toBe('/');
    for (const bad of ['plants', '//evil.com', '/a b', '/a/../b', '/a//b', `/${'x'.repeat(600)}`]) expect(normalisePath(bad)).toBeNull();
  });

  it('builds absolute canonicals on the pinned host with no trailing slash or query', () => {
    expect(canonicalUrl(site, '/plants/')).toBe('https://www.example.com/plants');
    expect(canonicalUrl(site, '/plants?sort=price')).toBe('https://www.example.com/plants');
    expect(canonicalUrl(site, '/plants', { page: 3 })).toBe('https://www.example.com/plants?page=3');
    expect(canonicalUrl(site, '/plants', { page: 1 })).toBe('https://www.example.com/plants');
    expect(canonicalUrl(site, '/')).toBe('https://www.example.com/');
  });
});

describe('metadata builder', () => {
  it('composes title, canonical, robots, OG and Twitter', () => {
    const m = metadataFor({ title: 'Alphonso Mango', description: 'Grafted sapling.', path: '/plant/Alphonso-Mango/' }, site);
    const typed: Metadata = m; // structurally a Next Metadata object
    expect(typed).toBeTruthy();
    expect(m.title.absolute).toBe('Alphonso Mango | Example Store');
    expect(m.alternates.canonical).toBe('https://www.example.com/plant/alphonso-mango');
    expect(m.robots).toEqual({ index: true, follow: true });
    expect(m.openGraph.images[0]!.url).toBe('https://www.example.com/og/plant/alphonso-mango');
    expect(m.twitter.card).toBe('summary_large_image');
    expect(m.alternates.languages).toBeUndefined();
  });

  it('applies noindex, pagination, image refs, overrides and hreflang', () => {
    const kn = siteIdentity({ url: 'https://shop.example.com', name: 'S', locales: ['en-IN', 'kn-IN'] });
    const m = metadataFor(
      { title: 'All plants', description: '', path: '/plants', page: 2, noindex: true, image: { id: 'x', src: '/media/a.webp', alt: 'A', width: 800, height: 600, blurDataURL: null, credit: null } },
      kn,
    );
    expect(m.robots.index).toBe(false);
    expect(m.alternates.canonical).toBe('https://shop.example.com/plants?page=2');
    expect(m.openGraph.images[0]).toEqual({ url: 'https://shop.example.com/media/a.webp', width: 800, height: 600, alt: 'A' });
    expect(m.alternates.languages?.['kn-IN']).toBe('https://shop.example.com/kn/plants');

    const o = metadataFor({ title: 'About', description: 'd', path: '/about' }, site, { title: 'Our story', description: null, noindex: true, canonical: '/about-us' });
    expect(o.title.absolute).toBe('Our story | Example Store');
    expect(o.description).toBe('d');
    expect(o.robots.index).toBe(false);
    expect(o.alternates.canonical).toBe('https://www.example.com/about-us');
  });

  it('clips long descriptions at a word boundary', () => {
    const m = metadataFor({ title: 't', description: 'word '.repeat(60), path: '/x' }, site);
    expect(m.description.length).toBeLessThanOrEqual(160);
    expect(m.description.endsWith('…')).toBe(true);
  });
});

// ---- JSON-LD: shapes modelled on the schema.org types and Google's required/recommended properties ----
const absUrl = z.string().regex(/^https:\/\/www\.example\.com\//);
const price = z.string().regex(/^\d+\.\d{2}$/);
const shapes = {
  Organization: z.object({ '@type': z.literal('Organization'), '@id': z.string(), name: z.string().min(1), url: absUrl, logo: z.object({ '@type': z.literal('ImageObject'), url: absUrl }), sameAs: z.array(z.url()) }),
  WebSite: z.object({
    '@type': z.literal('WebSite'),
    url: absUrl,
    name: z.string(),
    potentialAction: z.object({ '@type': z.literal('SearchAction'), target: z.object({ urlTemplate: z.string().includes('{search_term_string}') }), 'query-input': z.literal('required name=search_term_string') }),
  }),
  LocalBusiness: z.object({
    '@type': z.literal('GardenStore'),
    name: z.string(),
    address: z.object({ '@type': z.literal('PostalAddress'), streetAddress: z.string(), addressLocality: z.string(), postalCode: z.string(), addressCountry: z.literal('IN') }),
    geo: z.object({ '@type': z.literal('GeoCoordinates'), latitude: z.number(), longitude: z.number() }),
    openingHours: z.array(z.string()).min(1),
    telephone: z.string(),
  }),
  Product: z.object({
    '@type': z.literal('Product'),
    name: z.string().min(1),
    sku: z.string(),
    image: z.array(absUrl).min(1),
    description: z.string(),
    brand: z.object({ '@type': z.literal('Brand'), name: z.string() }),
    additionalProperty: z.array(z.object({ '@type': z.literal('PropertyValue'), name: z.string(), value: z.string() })),
    offers: z.object({
      '@type': z.literal('Offer'),
      price,
      priceCurrency: z.literal('INR'),
      priceValidUntil: z.iso.date(),
      availability: z.enum(['https://schema.org/InStock', 'https://schema.org/PreOrder', 'https://schema.org/OutOfStock']),
      url: absUrl,
      priceSpecification: z.tuple([
        z.object({ '@type': z.literal('UnitPriceSpecification'), price }),
        z.object({ '@type': z.literal('UnitPriceSpecification'), price, eligibleQuantity: z.object({ '@type': z.literal('QuantitativeValue'), minValue: z.number().int().positive() }) }),
      ]),
      hasMerchantReturnPolicy: z.object({ '@type': z.literal('MerchantReturnPolicy'), returnPolicyCategory: z.literal('https://schema.org/MerchantReturnNotPermitted'), applicableCountry: z.literal('IN') }),
    }),
    aggregateRating: z.object({ '@type': z.literal('AggregateRating'), ratingValue: z.number().min(1).max(5), reviewCount: z.number().int().min(1) }),
    review: z.array(z.object({ '@type': z.literal('Review'), author: z.object({ '@type': z.literal('Person'), name: z.string() }), reviewRating: z.object({ ratingValue: z.number() }) })).max(5),
  }),
  BreadcrumbList: z.object({
    '@type': z.literal('BreadcrumbList'),
    itemListElement: z.array(z.object({ '@type': z.literal('ListItem'), position: z.number().int(), name: z.string(), item: absUrl })).min(1),
  }),
  FAQPage: z.object({
    '@type': z.literal('FAQPage'),
    mainEntity: z.array(z.object({ '@type': z.literal('Question'), name: z.string(), acceptedAnswer: z.object({ '@type': z.literal('Answer'), text: z.string() }) })).min(1),
  }),
  CollectionPage: z.object({
    '@type': z.literal('CollectionPage'),
    name: z.string(),
    url: absUrl,
    mainEntity: z.object({ '@type': z.literal('ItemList'), itemListElement: z.array(z.object({ position: z.number(), url: absUrl })).max(24) }),
  }),
  Article: z.object({ '@type': z.literal('Article'), headline: z.string().max(110), datePublished: z.iso.datetime({ offset: true }), dateModified: z.iso.datetime({ offset: true }), image: z.array(absUrl), author: z.object({ '@id': z.string() }) }),
  VideoObject: z.object({ '@type': z.literal('VideoObject'), name: z.string(), description: z.string().min(1), thumbnailUrl: z.array(z.url()).min(1), uploadDate: z.iso.datetime({ offset: true }), embedUrl: z.url() }),
};

const product: ProductJsonLdInput = {
  name: 'Alphonso Mango',
  path: '/plant/alphonso-mango',
  sku: 'SKU-1',
  description: 'Grafted sapling.',
  images: ['/media/mango.webp'],
  pricePaise: 24_900,
  priceValidUntil: '2027-10-20',
  availability: 'in_stock',
  bulk: { minQty: 50, unitPaise: 19_900 },
  rating: { average: 4.66, count: 7 },
  reviews: Array.from({ length: 7 }, (_, i) => ({ author: `Buyer ${i}`, rating: 5, body: 'Healthy plant', date: '2026-09-01' })),
  additionalProperties: [{ name: 'Size class', value: 'L' }],
};

describe('JSON-LD builders', () => {
  const ld = createJsonLd(site);

  it('every builder output validates against its schema shape', () => {
    const cases: [keyof typeof shapes, JsonLdNode][] = [
      ['Organization', ld.organization()],
      ['WebSite', ld.website()],
      ['LocalBusiness', ld.localBusiness()],
      ['Product', ld.product(product)],
      ['BreadcrumbList', ld.breadcrumbs([{ name: 'Home', path: '/' }, { name: 'Plants', path: '/plants' }, { name: 'Mango', path: '/plant/alphonso-mango' }])],
      ['FAQPage', ld.faqPage([{ question: 'When to plant?', answer: 'At the start of the rains.' }])],
      ['CollectionPage', ld.collectionPage({ name: 'Fruit', path: '/plants/fruit', items: Array.from({ length: 30 }, (_, i) => ({ name: `P${i}`, path: `/plant/p${i}` })) })],
      ['Article', ld.article({ headline: 'How to plant', path: '/guides/how', datePublished: '2026-10-01T10:00:00+05:30', dateModified: '2026-10-02T10:00:00+05:30', image: '/media/g.webp' })],
      ['VideoObject', ld.videoObject({ name: 'Pit digging', description: '', thumbnailUrl: 'https://i.ytimg.com/vi/abc/hqdefault.jpg', uploadDate: '2026-10-01T10:00:00+05:30', contentUrl: null, embedUrl: 'https://www.youtube.com/embed/abc' })],
    ];
    for (const [type, node] of cases) {
      const r = shapes[type].safeParse(node);
      expect(r.success, `${type}: ${r.success ? '' : JSON.stringify(r.error.issues)}`).toBe(true);
    }
  });

  it('breadcrumb positions run 1..n and the collection list is capped at 24', () => {
    const b = ld.breadcrumbs([{ name: 'A', path: '/a' }, { name: 'B', path: '/b' }]) as unknown as { itemListElement: { position: number }[] };
    expect(b.itemListElement.map((i) => i.position)).toEqual([1, 2]);
    const c = ld.collectionPage({ name: 'X', path: '/x', items: Array.from({ length: 30 }, (_, i) => ({ name: `${i}`, path: `/p${i}` })) }) as unknown as { mainEntity: { numberOfItems: number } };
    expect(c.mainEntity.numberOfItems).toBe(24);
  });

  it('leaves out rating, reviews, bulk and return policy when unknown', () => {
    const plain = createJsonLd(siteIdentity({ url: 'https://www.example.com', name: 'S' }));
    const node = plain.product({ ...product, rating: null, reviews: [], bulk: null }) as Record<string, Record<string, unknown>>;
    expect(node.aggregateRating).toBeUndefined();
    expect(node.review).toBeUndefined();
    expect(node.offers!.priceSpecification).toBeUndefined();
    expect(node.offers!.hasMerchantReturnPolicy).toBeUndefined();
    expect(plain.website().potentialAction).toBeUndefined();
  });

  it('graph() escapes so no value can close the script tag', () => {
    const evil = '</script><script>alert(1)</script><!-- & \u2028';
    const text = ld.graph([ld.faqPage([{ question: evil, answer: evil }])]);
    expect(text).not.toMatch(/[<>&\u2028]/);
    expect(text).not.toContain('</script');
    const parsed = JSON.parse(text) as { '@context': string; '@graph': { mainEntity: { name: string }[] }[] };
    expect(parsed['@context']).toBe('https://schema.org');
    expect(parsed['@graph'][0]!.mainEntity[0]!.name).toBe(evil);
    expect(escapeJsonLd('a<b')).toBe('"a\\u003cb"');
  });
});

describe('redirect planning', () => {
  const map = (pairs: [string, string][]) => new Map(pairs);

  it('refuses invalid, self and loops', () => {
    expect(planRedirect(map([]), 'nope', '/b')).toEqual({ ok: false, reason: 'invalid' });
    expect(planRedirect(map([]), '/a/', '/A')).toEqual({ ok: false, reason: 'same' });
    expect(planRedirect(map([['/b', '/a']]), '/a', '/b')).toEqual({ ok: false, reason: 'loop' });
    expect(planRedirect(map([['/b', '/c'], ['/c', '/a']]), '/a', '/b')).toEqual({ ok: false, reason: 'loop' });
  });

  it('follows the target to its end and re-points rows that led to the source', () => {
    const plan = planRedirect(map([['/b', '/c'], ['/x', '/a'], ['/y', '/a']]), '/a', '/b');
    expect(plan).toEqual({ ok: true, from: '/a', to: '/c', upserts: [['/a', '/c'], ['/x', '/c'], ['/y', '/c']] });
  });

  it('stops on a pre-existing cycle it did not create', () => {
    expect(planRedirect(map([['/b', '/c'], ['/c', '/b']]), '/a', '/b')).toEqual({ ok: false, reason: 'loop' });
  });
});

describe('sitemaps, robots, llms.txt', () => {
  it('lists only clean, unique, non-redirected, indexable paths', () => {
    const urls = sitemapUrls(
      [{ path: '/a' }, { path: '/A/' }, { path: '/old' }, { path: '/hidden' }, { path: '/q?x=1' }, { path: 'bad' }, { path: '/b', lastModified: '2026-10-01T00:00:00Z' }],
      { redirected: new Set(['/old']), noindex: new Set(['/hidden']) },
    );
    expect(urls.map((u) => u.path)).toEqual(['/a', '/b']);
  });

  it('writes escaped urlset and index XML', () => {
    const xml = urlsetXml(site, [{ path: '/a&b', lastModified: '2026-10-01T00:00:00Z', changeFrequency: 'weekly', priority: 0.8 }]);
    expect(xml).toContain('<loc>https://www.example.com/a&amp;b</loc>');
    expect(xml).toContain('<lastmod>2026-10-01T00:00:00.000Z</lastmod>');
    expect(xml).toContain('<priority>0.8</priority>');
    expect(sitemapIndexXml(site, [{ name: 'products' }])).toContain('<loc>https://www.example.com/sitemap/products.xml</loc>');
  });

  it('robots allows AI crawlers by name, disallows private paths, points at the sitemap', () => {
    const txt = robotsTxt(site, { disallow: ['/cart', '/admin', '/cart'], allowIndexing: true });
    for (const bot of AI_CRAWLERS) expect(txt).toContain(`User-agent: ${bot}\nAllow: /`);
    expect(txt.match(/Disallow: \/cart/g)!.length).toBe(1 + AI_CRAWLERS.length);
    expect(txt).toContain('Sitemap: https://www.example.com/sitemap.xml');
    expect(robotsTxt(site, { disallow: [], allowIndexing: false })).toBe('User-agent: *\nDisallow: /\n');
  });

  it('llms.txt has the H1, summary and link sections', () => {
    const txt = llmsTxt(site, [{ title: 'Buying in bulk', body: 'Tiered prices from 50 plants.' }, { title: 'Pages', links: [{ title: 'About', path: '/about' }] }, { title: 'Empty' }]);
    expect(txt).toBe(
      '# Example Store\n\n> Plants and garden inputs.\n\n## Buying in bulk\n\nTiered prices from 50 plants.\n\n## Pages\n\n- [About](https://www.example.com/about)\n',
    );
  });
});
