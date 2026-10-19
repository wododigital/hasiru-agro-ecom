import { randomBytes } from 'node:crypto';
import { coreAuditLog } from '@ecomkit/core/schema';
import { createTestDb, queuedJobs, type TestDb } from '@ecomkit/core/testing';
import { fakeFit, fakeInventory, fakePricing, fakeReviews } from '@ecomkit/core/testing/fakes';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn() }));
const { updateTag } = await import('next/cache');

import { rowToFields } from '../src/server/import';
import { importSeed } from '../src/server/import';
import { dataGaps } from '../src/server/admin-queries';
import { buildCards } from '../src/server/cards';
import { facetSource, listProducts, movedSlug, sitemapEntries } from '../src/server/queries';
import { configureCatalog } from '../src/server/runtime';
import { deleteCollection, saveFaq, saveProduct } from '../src/server/write';
import { saveProductAction } from '../src/admin/actions';
import { catalogCollection, catalogProduct } from '../src/schema';
import { fakeImages, fakeMediaIds, writeSeedDir } from './fixtures';
import { fakeRegistry, signInAs, STAFF } from './helpers';

let t: TestDb;
const actor = { actorId: STAFF.userId, actorType: 'staff' as const };
const addRedirect = vi.fn(async () => {});

const product = async (sku: string) => (await t.db.select().from(catalogProduct).where(eq(catalogProduct.sku, sku)))[0]!;

beforeAll(async () => {
  process.env.INTERNAL_SECRET = 'z'.repeat(40);
  process.env.SETTINGS_MASTER_KEY = `1:${randomBytes(32).toString('base64')}`;
  t = await createTestDb('wp-04-server', { schemas: ['core', 'catalog'] });
  configureCatalog({ resolveMediaIds: fakeMediaIds() });
  await importSeed({ seedDir: await writeSeedDir() });
});

afterAll(async () => {
  await t?.close();
});

beforeEach(() => {
  vi.mocked(updateTag).mockClear();
  addRedirect.mockClear();
  configureCatalog({ addRedirect, images: fakeImages, readDistrict: async () => null });
});

describe('saveProduct', () => {
  it('creates a product with a default variant, audit row, events in the transaction and updateTag', async () => {
    const before = (await queuedJobs(t.db, 'core.event')).length;
    const fields = rowToFields(await product('P-0002'));
    const r = await saveProduct({ id: null, fields: { ...fields, sku: 'P-0100', slug: 'red-sanders', name: 'Red Sanders', status: 'active' }, variants: [] }, actor);
    expect(r).toMatchObject({ slug: 'red-sanders', previousSlug: null, expired: 'update' });
    const events = (await queuedJobs(t.db, 'core.event')).slice(before).map((j) => (j.data as { event: string }).event);
    expect(events.sort()).toEqual(['product.published', 'product.updated']); // same transaction, so no order between them
    expect(vi.mocked(updateTag).mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['catalog', `product:${r.id}`, 'category:timber']));
    const audit = await t.db.select().from(coreAuditLog).where(and(eq(coreAuditLog.entityId, r.id), eq(coreAuditLog.action, 'product.create')));
    expect(audit).toHaveLength(1);
    expect((await listProducts({ ids: [r.id] })).rows[0]).toMatchObject({ name: 'Red Sanders', variantId: expect.any(String) });
  });

  it('a slug change keeps the old slug (PDP 301) and records a redirect; the new owner of a slug wins it', async () => {
    const mango = await product('P-0001');
    const r = await saveProduct({ id: mango.id, fields: { ...rowToFields(mango), slug: 'alphonso-mango-grafted' }, variants: [] }, actor);
    expect(r.previousSlug).toBe('alphonso-mango');
    expect(addRedirect).toHaveBeenCalledWith('/plant/alphonso-mango', '/plant/alphonso-mango-grafted');
    expect(await movedSlug('alphonso-mango')).toEqual({ slug: 'alphonso-mango-grafted', kind: 'plant' });
    // Another product claims the old slug: it leaves the mango's history.
    const teak = await product('P-0002');
    await saveProduct({ id: teak.id, fields: { ...rowToFields(teak), slug: 'alphonso-mango' }, variants: [] }, actor);
    expect(await movedSlug('alphonso-mango')).toBeNull();
    expect((await product('P-0001')).previousSlugs).toEqual([]);
    await saveProduct({ id: teak.id, fields: { ...rowToFields(await product('P-0002')), slug: 'teak' }, variants: [] }, actor);
    expect(await movedSlug('alphonso-mango')).toEqual({ slug: 'teak', kind: 'plant' });
  });

  it('a redirect writer failure does not fail the save', async () => {
    addRedirect.mockRejectedValueOnce(new Error('seo down'));
    const neem = await product('P-0004');
    await expect(saveProduct({ id: neem.id, fields: { ...rowToFields(neem), slug: 'neem' }, variants: [] }, actor)).resolves.toMatchObject({ previousSlug: 'neem-native-sapling' });
  });

  it('guards: a published FAQ needs an answer; a collection in use cannot be deleted', async () => {
    await expect(saveFaq({ id: null, productId: null, question: 'Is it organic?', answerHtml: null, status: 'published', position: 0, source: null }, actor)).rejects.toThrow(/needs an answer/);
    const [desi] = await t.db.select().from(catalogCollection).where(eq(catalogCollection.slug, 'desi'));
    await expect(deleteCollection(desi!.id, actor)).rejects.toThrow();
  });
});

describe('reads', () => {
  it('collection listings include child collections; drafts and hidden products are left out', async () => {
    const fruiting = await listProducts({ kind: 'plant', collectionSlug: 'fruiting' });
    expect(fruiting.rows.map((r) => r.slug)).toEqual(['alphonso-mango-grafted']); // the Exotic draft is hidden
    const traits = await listProducts({ kind: 'plant', tagSlug: 'drought-tolerant', sort: 'name' });
    expect(traits.rows.map((r) => r.name)).toEqual(['Neem (Azadirachta indica)', 'Teak']);
    const teak = await product('P-0002');
    await saveProduct({ id: teak.id, fields: { ...rowToFields(teak), availabilityOverride: 'hidden' }, variants: [] }, actor);
    expect((await listProducts({ tagSlug: 'drought-tolerant' })).total).toBe(1);
    await saveProduct({ id: teak.id, fields: { ...rowToFields(await product('P-0002')), availabilityOverride: null }, variants: [] }, actor);
  });

  it('cards batch the optional modules (pricing, stock, reviews, fit, chip sources)', async () => {
    const { rows } = await listProducts({ kind: 'plant', sort: 'name' });
    const mango = rows.find((r) => r.slug === 'alphonso-mango-grafted')!;
    const resolve = vi.fn(async (ids: readonly string[]) => Object.fromEntries(ids.map((id) => [id, [{ id: 'cert', label: 'Certified', tone: 'neutral' as const }]])));
    configureCatalog({
      images: fakeImages,
      registry: fakeRegistry({
        services: { pricing: fakePricing(), inventory: fakeInventory({ [mango.variantId!]: 'out_of_stock' }), reviews: fakeReviews({ approved: 5 }), places: fakeFit() },
        lists: { productCardChips: [{ id: 'cert', order: 1, moduleId: 'x', resolve: async () => resolve }] },
      }),
    });
    const cards = await buildCards(rows, { district: 'bengaluru-urban' });
    expect(resolve).toHaveBeenCalledTimes(1);
    const card = cards.find((c) => c.id === mango.id)!;
    expect(card).toMatchObject({ availability: 'out_of_stock', notifyMe: true, purchasable: false, rating: { average: 4.6, count: 5, show: true }, price: { unitPaise: 49_000 } });
    expect(card.image).toMatchObject({ id: '00000000-0000-7000-8000-000000000001' });
    expect(card.chips.map((c) => c.id)).toEqual(['size', 'fit', 'bearing', 'cert']);
    const gliricidia = cards.find((c) => c.slug === 'gliricidia')!;
    expect(gliricidia.chips.map((c) => c.id)).toEqual(['size', 'cert']); // no climate data: no fit chip
  });

  it('facet source, sitemap entries and data gaps', async () => {
    const rows = await facetSource();
    expect(rows.length).toBe((await listProducts()).total);
    const mangoRow = rows.find((r) => r.facets.collection?.includes('desi'))!;
    expect(mangoRow.facets.collection).toEqual(['desi', 'fruiting']);
    const paths = (await sitemapEntries()).map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['/plant/teak', '/input/vermicompost-25-kg', '/plants/fruiting', '/plants/fruiting/desi', '/plants/drought-tolerant', '/plants/nitrogen-fixing']));
    expect(paths).not.toContain('/plant/old-listing-plant');
    const gaps = await dataGaps();
    expect(gaps.find((g) => g.sku === 'P-0005')).toMatchObject({ gaps: expect.arrayContaining(['needs_review', 'image_needed', 'no_climate']), notes: ['Keep, publish or delete?'] });
    expect(gaps.find((g) => g.sku === 'P-0002')!.gaps).toContain('unanswered_faqs');
  });
});

describe('admin product action', () => {
  it('refuses non-staff and reports field errors', async () => {
    const fd = new FormData();
    fd.set('_fields', 'name,slug,sku,kind');
    fd.set('name', 'X');
    fd.set('slug', 'Bad Slug');
    fd.set('sku', 'X-1');
    fd.set('kind', 'plant');
    signInAs({ kind: 'guest' });
    expect(await saveProductAction(null, fd)).toMatchObject({ ok: false, message: expect.stringMatching(/permission/) });
    signInAs(STAFF);
    expect(await saveProductAction(null, fd)).toMatchObject({ ok: false, fieldErrors: { slug: expect.any(Array) } });
  });

  it('saves one form section onto the stored product', async () => {
    signInAs(STAFF);
    const teak = await product('P-0002');
    const fd = new FormData();
    fd.set('id', teak.id);
    fd.set('_fields', 'shortDescription,noindex');
    fd.set('shortDescription', 'Durable timber.');
    expect(await saveProductAction(null, fd)).toEqual({ ok: true, message: 'Saved.' });
    const after = await product('P-0002');
    expect(after.shortDescription).toBe('Durable timber.');
    expect(after.name).toBe('Teak');
    expect(after.spacingFt).toEqual(teak.spacingFt);
  });
});
