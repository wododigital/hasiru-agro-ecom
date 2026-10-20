import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ImageRef } from '@ecomkit/core/contracts';
import { createTestDb, type TestDb } from '@ecomkit/core/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { pageInputSchema, type PageInput } from '../src/domain';
import { cmsBlock, cmsCounter, cmsPage, cmsTrustClaim } from '../src/schema';
import {
  CmsWriteError,
  configureCms,
  deleteEntity,
  getEntity,
  getMenu,
  getPage,
  getPortfolioItem,
  listClients,
  listPortfolio,
  listTeam,
  guideEntries,
  listCounters,
  listEntities,
  listPosts,
  listTrustClaims,
  pageEntries,
  saveEntity,
  saveMenu,
  savePage,
  videosFor,
} from '../src/server';
import { runSeed } from '../src/server/seed';

let t: TestDb;
const page = (o: Partial<Record<string, unknown>>): PageInput => pageInputSchema.parse({ title: 'About us', slug: 'about', status: 'published', template: 'default', blocks: [], ...o });
const log = { info: () => undefined, warn: () => undefined, error: () => undefined };

beforeAll(async () => {
  t = await createTestDb('wp-09-cms', { schemas: ['core', 'cms'] });
});
afterAll(async () => {
  await t?.close();
});
beforeEach(async () => {
  await t.db.execute(sql`truncate cms_page, cms_menu, cms_testimonial, cms_video, cms_post, cms_portfolio_item, cms_client, cms_team_member, cms_counter, cms_trust_claim, core_audit_log cascade`);
  configureCms({});
});

describe('pages and blocks', () => {
  it('saves blocks in order, sanitises rich text, serves only published pages', async () => {
    const id = await savePage(
      null,
      page({ blocks: [{ type: 'rich_text', data: { html: '<p onclick="x()">Hi<script>alert(1)</script></p>' } }, { type: 'faq', data: { items: [{ question: 'Q', answer: 'A' }] } }] }),
      null,
    );
    const got = await getPage('about');
    expect(got?.page.id).toBe(id);
    expect(got?.page.publishedAt).toBeInstanceOf(Date);
    expect(got?.blocks.map((b) => b.type)).toEqual(['rich_text', 'faq']);
    expect(got?.blocks[0]).toEqual({ type: 'rich_text', data: { html: '<p>Hi</p>' } });

    await savePage(id, page({ status: 'draft' }), null);
    expect(await getPage('about')).toBeNull();
    const audits = await t.db.execute<{ n: number }>(sql`select count(*)::int as n from core_audit_log where entity = 'cms_page'`);
    expect(audits.rows[0]!.n).toBe(2);
  });

  it('skips stored blocks that no longer validate and re-sanitises on read', async () => {
    const id = await savePage(null, page({}), null);
    await t.db.insert(cmsBlock).values([
      { pageId: id, position: 0, type: 'retired_type', data: {} },
      { pageId: id, position: 1, type: 'rich_text', data: { html: '<img src=x onerror=alert(1)>' } },
    ]);
    const got = await getPage('about');
    expect(got?.blocks).toEqual([{ type: 'rich_text', data: { html: '<img src="x" />' } }]);
  });

  it('refuses a taken slug and redirects a published page that moves', async () => {
    const addRedirect = vi.fn(async () => undefined);
    configureCms({ addRedirect });
    const id = await savePage(null, page({}), null);
    await savePage(null, page({ slug: 'team', title: 'Team' }), null);
    await expect(savePage(id, page({ slug: 'team' }), null)).rejects.toBeInstanceOf(CmsWriteError);
    await savePage(id, page({ slug: 'our-story' }), null);
    expect(addRedirect).toHaveBeenCalledWith('/about', '/our-story');
  });
});

describe('menus', () => {
  it('replaces items and reads a two-level tree', async () => {
    await saveMenu('footer', 'Footer', [{ label: 'Shop', href: '/plants', children: [{ label: 'Fruit', href: '/plants/fruit' }] }, { label: 'Instagram', href: 'https://instagram.com/x', children: [] }], null);
    let tree = await getMenu('footer');
    expect(tree.map((n) => [n.label, n.isExternal, n.children.map((c) => c.label)])).toEqual([
      ['Shop', false, ['Fruit']],
      ['Instagram', true, []],
    ]);
    await saveMenu('footer', 'Footer', [{ label: 'About', href: '/about', children: [] }], null);
    tree = await getMenu('footer');
    expect(tree.map((n) => n.label)).toEqual(['About']);
    expect(await getMenu('missing')).toEqual([]);
  });
});

describe('simple content types', () => {
  it('generic save, list, get and delete; slug and key clashes refused', async () => {
    const id = await saveEntity('testimonials', null, { name: 'Ravi', body: 'Healthy saplings.', position: 0, status: 'published' }, null);
    expect((await listEntities('testimonials')).rows.map((r) => r.name)).toEqual(['Ravi']);
    await saveEntity('testimonials', id, { name: 'Ravi K', body: 'Healthy saplings.', position: 0, status: 'published' }, null);
    expect((await getEntity('testimonials', id))?.name).toBe('Ravi K');
    await deleteEntity('testimonials', id, null);
    expect(await getEntity('testimonials', id)).toBeNull();

    await saveEntity('guides', null, { slug: 'pit-digging', title: 'Pit digging', bodyHtml: '<p>x</p>', publishedAt: null, status: 'published', noindex: false }, null);
    await expect(saveEntity('guides', null, { slug: 'pit-digging', title: 'Again', bodyHtml: '', publishedAt: null, status: 'draft', noindex: false }, null)).rejects.toMatchObject({ code: 'slug_taken' });
    expect(await saveEntity('counters', null, { key: 'acres', label: 'Acres', value: 120, verified: false, position: 0 }, null)).toBe('acres');
    await expect(saveEntity('counters', null, { key: 'acres', label: 'x', value: 1, verified: false, position: 0 }, null)).rejects.toMatchObject({ code: 'slug_taken' });
  });

  it('storefront shows only verified counters, shown trust claims, dated published guides', async () => {
    await t.db.insert(cmsCounter).values([
      { key: 'acres', label: 'Acres', value: 120, verified: true },
      { key: 'farms', label: 'Farms', value: 40, verified: false },
    ]);
    await t.db.insert(cmsTrustClaim).values([
      { key: 'incubated', label: 'Incubated at a university', show: true },
      { key: 'rating', label: 'Rated', value: '4.8', show: false },
    ]);
    expect((await listCounters()).map((c) => c.key)).toEqual(['acres']);
    expect((await listTrustClaims()).map((c) => c.key)).toEqual(['incubated']);

    await saveEntity('guides', null, { slug: 'now', title: 'Now', bodyHtml: '', publishedAt: null, status: 'published', noindex: false }, null);
    await saveEntity('guides', null, { slug: 'later', title: 'Later', bodyHtml: '', publishedAt: new Date(Date.now() + 86_400_000), status: 'published', noindex: false }, null);
    await saveEntity('guides', null, { slug: 'hidden', title: 'Hidden', bodyHtml: '', publishedAt: null, status: 'published', noindex: true }, null);
    await saveEntity('guides', null, { slug: 'draft', title: 'Draft', bodyHtml: '', publishedAt: null, status: 'draft', noindex: false }, null);
    expect((await listPosts()).map((p) => p.slug).sort()).toEqual(['hidden', 'now']);
    expect((await guideEntries()).map((e) => e.path)).toEqual(['/guides/now']);
  });

  it('videos link to products and planting models; ids keep their order; drafts never show', async () => {
    const product = '0192a000-0000-7000-8000-0000000000a1';
    const a = await saveEntity('videos', null, { title: 'Planting a mango', url: 'https://youtu.be/dQw4w9WgXcQ', kind: 'youtube', productId: product, position: 1, status: 'published' }, null);
    const b = await saveEntity('videos', null, { title: 'Food forest walk', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', kind: 'youtube', modelSlug: 'food-forest', category: 'diy', position: 0, status: 'published' }, null);
    await saveEntity('videos', null, { title: 'Draft', url: 'https://youtu.be/bbbbbbbbbbb', kind: 'youtube', productId: product, position: 0, status: 'draft' }, null);
    expect((await videosFor({ productId: product })).map((v) => v.title)).toEqual(['Planting a mango']);
    expect((await videosFor({ modelSlug: 'food-forest' })).map((v) => v.title)).toEqual(['Food forest walk']);
    expect((await videosFor({ category: 'diy' })).map((v) => v.id)).toEqual([b]);
    expect((await videosFor({ ids: [a, b] })).map((v) => v.id)).toEqual([a, b]);
    const [view] = await videosFor({ ids: [a] });
    expect(view).toMatchObject({ embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', poster: null });

    // With media bound, a poster image replaces the YouTube thumbnail.
    const poster: ImageRef = { id: 'm', src: '/media/poster.webp', alt: '', width: 1280, height: 720, blurDataURL: null, credit: null };
    const posterId = '0192a000-0000-7000-8000-0000000000b1';
    await saveEntity('videos', a, { title: 'Planting a mango', url: 'https://youtu.be/dQw4w9WgXcQ', kind: 'youtube', productId: product, posterMediaId: posterId, position: 1, status: 'published' }, null);
    configureCms({ images: async (ids) => Object.fromEntries(ids.map((id) => [id, { ...poster, id }])) });
    expect((await videosFor({ ids: [a] }))[0]).toMatchObject({ poster: { src: '/media/poster.webp' }, thumbnailUrl: '/media/poster.webp' });
  });
});

describe('portfolio, clients and team', () => {
  it('storefront reads return published rows in order; project stories are sanitised', async () => {
    await saveEntity('portfolio', null, { slug: 'coffee-estate', title: 'Coffee estate', location: 'Kodagu', landSizeAcres: 12.5, gallery: [], bodyHtml: '<p>Before and after.</p><iframe src="x"></iframe>', position: 1, status: 'published' }, null);
    await saveEntity('portfolio', null, { slug: 'draft-project', title: 'Draft', gallery: [], bodyHtml: '', position: 0, status: 'draft' }, null);
    await saveEntity('clients', null, { name: 'Green Acres Farm', projectType: 'Food forest', acreage: 3, position: 0, status: 'published' }, null);
    await saveEntity('clients', null, { name: 'Hidden Client', position: 1, status: 'draft' }, null);
    await saveEntity('team', null, { name: 'B', role: 'Agronomist', position: 2, status: 'published' }, null);
    await saveEntity('team', null, { name: 'A', role: 'Founder', position: 1, status: 'published' }, null);
    expect((await listPortfolio()).map((p) => p.slug)).toEqual(['coffee-estate']);
    expect(await getPortfolioItem('coffee-estate')).toMatchObject({ landSizeAcres: 12.5, bodyHtml: '<p>Before and after.</p>' });
    expect(await getPortfolioItem('draft-project')).toBeNull();
    expect((await listClients()).map((c) => c.name)).toEqual(['Green Acres Farm']);
    expect((await listTeam()).map((m) => m.name)).toEqual(['A', 'B']);
  });
});

describe('sitemap source', () => {
  it('lists published indexable pages only (drafts, noindex and draft policies excluded)', async () => {
    await savePage(null, page({}), null);
    await savePage(null, page({ slug: 'landing', title: 'L', noindex: 'on' }), null);
    await savePage(null, page({ slug: 'policies/privacy', title: 'Privacy', status: 'draft' }), null);
    await savePage(null, page({ slug: 'draft-page', title: 'D', status: 'draft' }), null);
    expect((await pageEntries()).map((e) => e.path)).toEqual(['/about']);
  });
});

describe('seed hook', () => {
  it('seeds content once; policy pages keep the file status but always land noindex', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wp09-cms-'));
    writeFileSync(
      join(dir, 'cms.json'),
      JSON.stringify({
        version: 1,
        records: {
          pages: [
            { slug: 'about', title: 'About', status: 'published', noindex: false, blocks: [{ type: 'rich_text', props: { html: '<p>We grow plants.</p>' }, sort: 1 }, { type: 'carousel', props: {}, sort: 2 }], seo: { title: 'About', description: 'd' } },
            { slug: 'policies/delivery', title: 'Delivery policy', status: 'published', noindex: false, blocks: [], seo: {} },
          ],
          menus: [{ key: 'footer', label: 'Footer', items: [{ label: 'About', href: '/about' }] }],
          testimonials: [{ key: 't1', author: 'Asha', location: 'Mysuru', body: 'Great plants.', source: 'current_site', sort: 1 }],
          team: [{ key: 'm1', name: 'A. Person', role: 'Founder', sort: 1 }],
          trust_claims: [{ key: 'rating', label: 'Rated', value: '4.8', logo: null, visible: false, sort: 1 }],
          counters: [{ key: 'acres', label: 'Acres', value: 10, verified: false, sort: 1 }],
        },
      }),
    );
    const ctx = { seedDir: dir, mediaDir: dir, dryRun: false, log };
    const first = await runSeed(ctx);
    expect(first.inserted).toBe(7);
    expect(first.notes).toEqual(['page about: block carousel skipped (unknown type or invalid data)']);
    expect(await runSeed(ctx)).toMatchObject({ inserted: 0, skipped: 7 });

    const policy = (await t.db.select().from(cmsPage).where(sql`slug = 'policies/delivery'`))[0]!;
    expect(policy).toMatchObject({ status: 'published', noindex: true, template: 'policy' });
    expect(await getPage('policies/delivery')).not.toBeNull();
    expect((await pageEntries()).map((e) => e.path)).toEqual(['/about']);
    expect((await listTrustClaims()).length).toBe(0);
    expect((await getMenu('footer')).map((n) => n.href)).toEqual(['/about']);
  });
});
