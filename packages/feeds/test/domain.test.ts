import { describe, expect, it } from 'vitest';
import { csvField, feedPrice, forDestination, htmlToText, META_COLUMNS, renderGoogleXml, renderMetaCsv, stableItemText, toFeedItem, validateFeedItem, type FeedSourceRow } from '../src/domain';

const NOW = new Date('2026-10-20T10:00:00+05:30');
const ctx = { origin: 'https://shop.example', brand: 'Sample Brand', googleCategory: { plant: 'Home & Garden > Plants', input: '' }, now: NOW };
const row = (over: Partial<FeedSourceRow> = {}): FeedSourceRow => ({
  productId: 'p1',
  variantId: 'v1',
  sku: 'PLT-0001-01',
  productSku: 'PLT-0001',
  kind: 'plant',
  slug: 'sample-sapling',
  name: 'Sample Sapling',
  variantLabel: '2 ft',
  skuSuffix: '-01',
  variantCount: 1,
  shortDescription: 'A hardy sapling.',
  descriptionHtml: '<p>Grows <strong>fast</strong> &amp; tall.</p><ul><li>Full sun</li></ul>',
  collectionPath: ['Fruiting trees', 'Exotic'],
  imageWebp: '/media/d/ab/0123456789abcdef0123456789abcdef/800.webp',
  imageJpeg: '/media/d/ab/0123456789abcdef0123456789abcdef/share.jpg',
  additionalImages: [],
  listPaise: 249_900,
  compareAtPaise: null,
  availability: 'in_stock',
  readyInDays: null,
  ...over,
});

describe('item mapping', () => {
  it('maps a variant to a feed item with GST-inclusive price, absolute links and no identifiers', () => {
    const i = toFeedItem(row(), ctx);
    expect(i).toMatchObject({
      id: 'PLT-0001-01',
      itemGroupId: null,
      title: 'Sample Sapling',
      description: 'Grows fast & tall.\n- Full sun',
      link: 'https://shop.example/plant/sample-sapling',
      imageLink: 'https://shop.example/media/d/ab/0123456789abcdef0123456789abcdef/800.webp',
      pricePaise: 249_900,
      salePricePaise: null,
      identifierExists: false,
      productType: 'Fruiting trees > Exotic',
    });
    expect(feedPrice(249_900)).toBe('2499.00 INR');
    expect(feedPrice(5)).toBe('0.05 INR');
  });

  it('groups variants, links to the variant and uses compare-at as the regular price', () => {
    const i = toFeedItem(row({ variantCount: 3, compareAtPaise: 300_000, kind: 'input', slug: 'sample-compost' }), ctx);
    expect(i).toMatchObject({ itemGroupId: 'PLT-0001', title: 'Sample Sapling (2 ft)', link: 'https://shop.example/input/sample-compost?variant=-01', pricePaise: 300_000, salePricePaise: 249_900 });
  });

  it('gives pre-orders an availability date and Meta the JPEG', () => {
    const i = toFeedItem(row({ availability: 'preorder', readyInDays: 10 }), ctx);
    expect(i.availabilityDate).toBe('2026-10-30');
    expect(forDestination(i, row(), 'meta', ctx.origin).imageLink).toBe('https://shop.example/media/d/ab/0123456789abcdef0123456789abcdef/share.jpg');
    expect(forDestination(i, row(), 'google', ctx.origin).imageLink).toMatch(/800\.webp$/);
  });

  it('hash text is stable and sensitive to every field', () => {
    const a = toFeedItem(row(), ctx);
    expect(stableItemText(a)).toBe(stableItemText({ ...a }));
    expect(stableItemText(a)).not.toBe(stableItemText({ ...a, availability: 'out_of_stock' }));
  });

  it('decodes entities and drops tags', () => {
    expect(htmlToText('<h2>Care</h2><p>Water&nbsp;weekly &#43; less in rain</p>')).toBe('Care\nWater weekly + less in rain');
    expect(htmlToText(null)).toBe('');
  });
});

describe('validation: required fields for both destinations', () => {
  const required = ['id', 'title', 'description', 'link', 'image_link', 'price', 'brand'];
  it.each(['google', 'meta'] as const)('%s: a complete item passes, and each missing field is an error', (destination) => {
    const ok = toFeedItem(row(), ctx);
    expect(validateFeedItem(ok, destination).filter((i) => i.severity === 'error')).toEqual([]);
    const broken = { ...ok, id: '', title: ' ', description: '', link: '', imageLink: null, pricePaise: null, brand: '' };
    expect(
      validateFeedItem(broken, destination)
        .filter((i) => i.severity === 'error')
        .map((i) => i.field)
        .sort(),
    ).toEqual([...required].sort());
  });

  it('refuses http links in production, zero prices, sale above price and pre-orders without a date', () => {
    const ok = toFeedItem(row(), ctx);
    const fields = (item: typeof ok) => validateFeedItem(item, 'google').filter((i) => i.severity === 'error').map((i) => i.field);
    expect(fields({ ...ok, link: 'http://shop.example/plant/x' })).toEqual(['link']);
    expect(fields({ ...ok, pricePaise: 0 })).toEqual(['price']);
    expect(fields({ ...ok, salePricePaise: 300_000 })).toEqual(['sale_price']);
    expect(fields({ ...ok, availability: 'preorder', availabilityDate: null })).toEqual(['availability_date']);
    expect(validateFeedItem({ ...ok, googleProductCategory: '' }, 'google').map((i) => i.severity)).toEqual(['warning']);
  });
});

describe('rendering', () => {
  it('Google XML: RSS 2.0 with the g: namespace, escaped text, identifier_exists no', () => {
    const items = [toFeedItem(row({ name: 'Rose & <Lily> "Mix"' }), ctx)];
    const xml = renderGoogleXml(items, { title: 'Shop', link: 'https://shop.example', description: 'Product feed' });
    expect(xml).toContain('<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">');
    expect(xml).toContain('<g:title>Rose &amp; &lt;Lily&gt; &quot;Mix&quot;</g:title>');
    expect(xml).toContain('<g:price>2499.00 INR</g:price>');
    expect(xml).toContain('<g:identifier_exists>no</g:identifier_exists>');
    expect(xml).toContain('<g:availability>in_stock</g:availability>');
    expect(xml).toContain('<g:google_product_category>Home &amp; Garden &gt; Plants</g:google_product_category>');
    expect(xml).not.toContain('<g:sale_price>');
    expect(xml).not.toContain('<g:item_group_id>');
  });

  it('Meta CSV: required columns, Meta availability words, RFC 4180 quoting', () => {
    const csv = renderMetaCsv([toFeedItem(row({ shortDescription: null, descriptionHtml: '<p>Says "hello", twice</p>' }), ctx)]);
    const [header, line] = csv.split('\r\n');
    expect(header).toBe(META_COLUMNS.join(','));
    for (const c of ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand']) expect(header!.split(',')).toContain(c);
    expect(line).toContain('"Says ""hello"", twice"');
    expect(line).toContain(',in stock,new,2499.00 INR,,');
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a\nb')).toBe('"a\nb"');
  });
});

describe('htmlToText entity safety', () => {
  it('keeps invalid numeric entities as text instead of throwing', () => {
    expect(htmlToText('a &#x110000; b &#99999999999; c &#xD800; d &#65; &#x42;')).toBe('a &#x110000; b &#99999999999; c &#xD800; d A B');
  });
});
