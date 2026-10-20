import { randomBytes } from 'node:crypto';
import { catalogCollection, catalogProduct, catalogProductMedia, catalogVariant } from '@ecomkit/catalog/schema';
import { ensureQueue, getBoss } from '@ecomkit/core/jobs';
import { resetEnv } from '@ecomkit/core/env';
import { newId } from '@ecomkit/core/ids';
import { setSettings } from '@ecomkit/core/settings';
import { createTestDb, queuedJobs, type TestDb } from '@ecomkit/core/testing';
import { inventoryLevel } from '@ecomkit/inventory/schema';
import { mediaAsset } from '@ecomkit/media/schema';
import { pricingPrice } from '@ecomkit/pricing/schema';
import { configurePricing } from '@ecomkit/pricing/server';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import manifest from '../src/manifest';
import { feedsFile, feedsItemState, feedsRun } from '../src/schema';
import { feedImagePaths, loadFeedRows, regenerateFeeds, rotateFeedToken, scheduleRegenerate, serveFeed, settingsDef } from '../src/server';
import { onChange, REGENERATE_JOB } from '../src/server/generate';

let t: TestDb;
const hex = () => randomBytes(16).toString('hex');
const P1 = newId();
const P2 = newId();
const P3 = newId();
const V1 = newId();
const V2a = newId();
const V2b = newId();
const V3 = newId();
const MEDIA = newId();
const MEDIA_BASE = `ab/${hex()}`;

beforeAll(async () => {
  process.env.INTERNAL_SECRET = 'f'.repeat(40);
  process.env.SETTINGS_MASTER_KEY = `1:${randomBytes(32).toString('base64')}`;
  process.env.SITE_URL = 'https://shop.example';
  resetEnv();
  // CREATE DATABASE from the template plus six schemas: slow under the parallel workspace run.
  t = await createTestDb('wp-23-feeds', { schemas: ['core', 'catalog', 'pricing', 'inventory', 'media', 'feeds'] });
  configurePricing({ gstRates: async (ids) => Object.fromEntries(ids.map((id) => [id, 0])), variantsOf: async () => [] });
  await setSettings(settingsDef, { brand: 'Sample Brand', googleCategoryPlant: 'Home & Garden > Plants', feedToken: 'feed-token-0123456789' }, { actorId: null, actorType: 'system' });

  const [coll] = await t.db.insert(catalogCollection).values({ slug: 'fruit', name: 'Fruit trees', kind: 'plant' }).returning();
  await t.db.insert(mediaAsset).values({ id: MEDIA, kind: 'image', storageKey: `public/m/${MEDIA_BASE}.webp`, originalName: 'a.jpg', mime: 'image/webp', width: 1600, height: 1200, bytes: 1000, sha256: hex(), status: 'ready', alt: 'Sapling' });
  await t.db.insert(catalogProduct).values([
    { id: P1, sku: 'PLT-0001', kind: 'plant', slug: 'sample-sapling', name: 'Sample Sapling', status: 'active', collectionId: coll!.id, descriptionHtml: '<p>Hardy and quick.</p>' },
    { id: P2, sku: 'INP-0002', kind: 'input', slug: 'sample-compost', name: 'Sample Compost', status: 'active', shortDescription: 'Rich compost.' },
    { id: P3, sku: 'PLT-0003', kind: 'plant', slug: 'draft-plant', name: 'Draft Plant', status: 'draft' },
  ]);
  await t.db.insert(catalogVariant).values([
    { id: V1, productId: P1, label: 'Standard', skuSuffix: '-01', isDefault: true },
    { id: V2a, productId: P2, label: '25 kg', skuSuffix: '-01', isDefault: true, position: 0 },
    { id: V2b, productId: P2, label: '50 kg', skuSuffix: '-02', position: 1 },
    { id: V3, productId: P3, label: 'Standard', skuSuffix: '-01', isDefault: true },
  ]);
  await t.db.insert(catalogProductMedia).values([
    { productId: P1, mediaId: MEDIA, role: 'main' },
    { productId: P2, mediaId: MEDIA, role: 'main' },
  ]);
  await t.db.insert(pricingPrice).values([
    { variantId: V1, productId: P1, pricePaise: 49_000, compareAtPaise: 70_000 },
    { variantId: V2a, productId: P2, pricePaise: 120_000 },
    // V2b deliberately unpriced: it must be rejected with a reason, not shipped at Rs 0.
    { variantId: V3, productId: P3, pricePaise: 10_000 },
  ]);
  await t.db.insert(inventoryLevel).values([
    { variantId: V1, productId: P1, onHand: 40 },
    { variantId: V2a, productId: P2, onHand: 0 },
  ]);
}, 180_000);
afterAll(async () => {
  await t?.close();
});

const file = async (d: 'google' | 'meta') => (await t.db.select().from(feedsFile).where(eq(feedsFile.destination, d)))[0]!;
const get = (path: string, headers: Record<string, string> = {}) => new Request(`https://shop.example${path}`, { headers });

describe('feed source', () => {
  it('reads visible variants through the catalog, pricing, inventory and media APIs', async () => {
    const rows = await loadFeedRows();
    expect(rows.map((r) => r.sku).sort()).toEqual(['INP-0002-01', 'INP-0002-02', 'PLT-0001-01']);
    const v1 = rows.find((r) => r.variantId === V1)!;
    expect(v1).toMatchObject({ listPaise: 49_000, compareAtPaise: 70_000, availability: 'in_stock', collectionPath: ['Fruit trees'], imageWebp: `/media/d/${MEDIA_BASE}/800.webp`, imageJpeg: `/media/d/${MEDIA_BASE}/share.jpg` });
    expect(rows.find((r) => r.variantId === V2a)!.availability).toBe('out_of_stock');
    expect(feedImagePaths({ src: `/media/m/${MEDIA_BASE}.webp`, width: 640 }).webp).toBe(`/media/d/${MEDIA_BASE}/640.webp`);
  });
});

describe('regeneration', () => {
  it('builds both files, keeps invalid items out with a reason, and rebuilds only when a hash changes', async () => {
    const [g, m] = await regenerateFeeds();
    expect(g).toMatchObject({ destination: 'google', kind: 'full', items: 2, errors: 1, added: 2, rewritten: true });
    expect(m).toMatchObject({ destination: 'meta', items: 2, errors: 1 });
    const rejected = await t.db.select().from(feedsItemState).where(eq(feedsItemState.variantId, V2b));
    expect(rejected.map((r) => [r.destination, r.hash, r.lastError])).toEqual(
      expect.arrayContaining([
        ['google', null, 'price: price is required (variant has no price)'],
        ['meta', null, 'price: price is required (variant has no price)'],
      ]),
    );
    const xml = (await file('google')).body;
    expect(xml).toContain('<g:id>PLT-0001-01</g:id>');
    expect(xml).toContain('<g:price>700.00 INR</g:price>');
    expect(xml).toContain('<g:sale_price>490.00 INR</g:sale_price>');
    expect(xml).toContain(`<g:image_link>https://shop.example/media/d/${MEDIA_BASE}/800.webp</g:image_link>`);
    expect(xml).toContain('<g:availability>out_of_stock</g:availability>');
    expect(xml).not.toContain('Draft Plant');
    expect((await file('meta')).body).toContain(`https://shop.example/media/d/${MEDIA_BASE}/share.jpg`);

    const before = await file('google');
    const statesBefore = await t.db.select().from(feedsItemState).where(eq(feedsItemState.destination, 'google'));
    const [again] = await regenerateFeeds({ destinations: ['google'], now: new Date(Date.now() + 3_600_000) });
    expect(again).toMatchObject({ kind: 'delta', rewritten: false, added: 0, changed: 0, removed: 0, unchanged: 2 });
    const after = await file('google');
    expect(after.generatedAt.getTime()).toBe(before.generatedAt.getTime());
    expect(after.etag).toBe(before.etag);
    expect(await t.db.select().from(feedsItemState).where(eq(feedsItemState.destination, 'google'))).toEqual(statesBefore);

    await t.db.update(pricingPrice).set({ pricePaise: 45_000 }).where(eq(pricingPrice.variantId, V1));
    const [changed] = await regenerateFeeds({ destinations: ['google'] });
    expect(changed).toMatchObject({ rewritten: true, changed: 1, unchanged: 1 });
    expect((await file('google')).body).toContain('<g:sale_price>450.00 INR</g:sale_price>');
    expect((await file('google')).etag).not.toBe(before.etag);

    await t.db.insert(pricingPrice).values({ variantId: V2b, productId: P2, pricePaise: 200_000 });
    const [fixed] = await regenerateFeeds({ destinations: ['google'] });
    expect(fixed).toMatchObject({ added: 1, errors: 0, items: 3 });
    expect((await t.db.select().from(feedsItemState).where(eq(feedsItemState.variantId, V2b))).find((r) => r.destination === 'google')).toMatchObject({ lastError: null });

    await t.db.update(catalogProduct).set({ status: 'archived' }).where(eq(catalogProduct.id, P2));
    const [removed] = await regenerateFeeds({ destinations: ['google'] });
    expect(removed).toMatchObject({ removed: 2, items: 1, rewritten: true });
    expect((await file('google')).body).not.toContain('INP-0002');
    await t.db.update(catalogProduct).set({ status: 'active' }).where(eq(catalogProduct.id, P2));

    const runs = await t.db.select().from(feedsRun).where(eq(feedsRun.destination, 'google'));
    expect(runs.length).toBeGreaterThanOrEqual(5);
  });
});

describe('serving', () => {
  it('requires the token, answers 404 when the destination is off, supports ETag', async () => {
    expect((await serveFeed('google', get('/feeds/google.xml'))).status).toBe(403);
    expect((await serveFeed('google', get('/feeds/google.xml?token=wrong'))).status).toBe(403);
    const ok = await serveFeed('google', get('/feeds/google.xml?token=feed-token-0123456789'));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('application/xml; charset=utf-8');
    expect(ok.headers.get('x-robots-tag')).toBe('noindex');
    expect(await ok.text()).toContain('<rss');
    expect((await serveFeed('google', get('/feeds/google.xml?token=feed-token-0123456789', { 'if-none-match': ok.headers.get('etag')! }))).status).toBe(304);
    const csv = await serveFeed('meta', get('/feeds/meta.csv?token=feed-token-0123456789'));
    expect(csv.headers.get('content-type')).toBe('text/csv; charset=utf-8');

    await setSettings(settingsDef, { metaEnabled: false }, { actorId: null, actorType: 'system' });
    expect((await serveFeed('meta', get('/feeds/meta.csv?token=feed-token-0123456789'))).status).toBe(404);
    await setSettings(settingsDef, { metaEnabled: true }, { actorId: null, actorType: 'system' });

    const fresh = await rotateFeedToken(null);
    expect(fresh).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await serveFeed('google', get('/feeds/google.xml?token=feed-token-0123456789'))).status).toBe(403);
    expect((await serveFeed('google', get(`/feeds/google.xml?token=${fresh}`))).status).toBe(200);
  });

  it('builds the file on the first fetch when none exists yet', async () => {
    await t.db.delete(feedsFile).where(eq(feedsFile.destination, 'meta'));
    const { feedToken } = await import('../src/server/config').then((m) => m.loadSettings());
    const res = await serveFeed('meta', get(`/feeds/meta.csv?token=${feedToken}`));
    expect(res.status).toBe(200);
    expect((await res.text()).split('\r\n')[0]).toMatch(/^id,title,description,availability,condition,price/);
  });
});

describe('debounced rebuild on catalog events', () => {
  it('a burst of product, price and stock events queues one delayed rebuild', async () => {
    const boss = await getBoss();
    await ensureQueue(boss, REGENERATE_JOB, manifest.jobs![REGENERATE_JOB]!.options);
    const now = Date.now();
    const first = await scheduleRegenerate(now);
    expect(first).toBeTruthy();
    await onChange();
    await onChange();
    await onChange();
    const jobs = (await queuedJobs(t.db, REGENERATE_JOB)).filter((j) => j.state === 'created');
    expect(jobs).toHaveLength(1);
    const { rows } = await t.pool.query(`select start_after from pgboss.job where id = $1`, [first]);
    expect(new Date(rows[0].start_after).getTime()).toBeGreaterThanOrEqual(now + 119_000);
  });
});
