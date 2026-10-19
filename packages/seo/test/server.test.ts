import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ForbiddenError, setAuthProvider } from '@ecomkit/core/auth-context';
import type { AuthContext, SitemapSource, StaffViewer } from '@ecomkit/core/contracts';
import { createTestDb, type TestDb } from '@ecomkit/core/testing';
import { eq, sql } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addRedirectForm, savePageMetaForm } from '../src/admin/actions';
import { SeoProductTab } from '../src/admin/SeoProductTab';
import { seoNotFound, seoPageMeta, seoRedirect } from '../src/schema';
import {
  addRedirect,
  configureSeo,
  fixNotFound,
  getPageMeta,
  llmsResponse,
  logNotFound,
  ogResponse,
  pageMetadata,
  pruneNotFound,
  redirectFor,
  RedirectError,
  resetRedirectCache,
  resolveMissing,
  robotsResponse,
  savePageMeta,
  sitemapFileResponse,
  sitemapFiles,
  sitemapIndexResponse,
} from '../src/server';
import { runSeed } from '../src/server/seed';

let t: TestDb;
const SITE = { url: 'https://www.example.com', name: 'Example Store', description: 'Plants.', searchPath: '/search' };

const staff = (permissions: StaffViewer['permissions']): AuthContext => {
  const viewer: StaffViewer = { kind: 'staff', userId: '0192a000-0000-7000-8000-000000000001', name: 'Admin', email: 'a@example.com', role: 'owner', permissions };
  return {
    getViewer: async () => viewer,
    requirePermission: async (p) => {
      if (!permissions.includes(p)) throw new ForbiddenError();
      return viewer;
    },
    requireOwner: async () => {
      throw new Error('not used');
    },
  };
};

const digest = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn();
  } catch (err) {
    return String((err as { digest?: string }).digest ?? err);
  }
  return 'no throw';
};

beforeAll(async () => {
  t = await createTestDb('wp-09-seo', { schemas: ['core', 'seo'] });
});
afterAll(async () => {
  setAuthProvider(async () => null);
  await t?.close();
});
beforeEach(async () => {
  await t.db.execute(sql`truncate seo_redirect, seo_not_found, seo_page_meta, core_audit_log cascade`);
  resetRedirectCache();
  configureSeo({ site: SITE });
});

describe('redirects', () => {
  it('adds, resolves case/slash variants, collapses chains and audits', async () => {
    await addRedirect('/product/old-mango', '/plant/mango');
    expect(await redirectFor('/Product/Old-Mango/')).toEqual({ from: '/product/old-mango', to: '/plant/mango', statusCode: 301 });

    // slug renamed again: the old row is re-pointed, no chain
    await addRedirect('/plant/mango', '/plant/alphonso-mango');
    const rows = await t.db.select().from(seoRedirect).orderBy(seoRedirect.fromPath);
    expect(rows.map((r) => [r.fromPath, r.toPath, r.source])).toEqual([
      ['/plant/mango', '/plant/alphonso-mango', 'slug_change'],
      ['/product/old-mango', '/plant/alphonso-mango', 'slug_change'],
    ]);
    const audits = await t.db.execute<{ n: number }>(sql`select count(*)::int as n from core_audit_log where action = 'redirect.upsert'`);
    expect(audits.rows[0]!.n).toBe(2);
  });

  it('refuses a loop and keeps the table unchanged', async () => {
    await addRedirect('/a', '/b');
    await addRedirect('/b', '/c');
    await expect(addRedirect('/c', '/a')).rejects.toBeInstanceOf(RedirectError);
    await expect(addRedirect('/x', '/x')).rejects.toMatchObject({ reason: 'same' });
    const rows = await t.db.select().from(seoRedirect);
    expect(rows.map((r) => `${r.fromPath}>${r.toPath}`).sort()).toEqual(['/a>/c', '/b>/c']);
  });

  it('two opposite writers at once never build a loop (advisory lock)', async () => {
    const results = await Promise.allSettled([addRedirect('/p', '/q'), addRedirect('/q', '/p')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await t.db.select().from(seoRedirect)).toHaveLength(1);
  });

  it('resolveMissing answers a real permanent redirect and counts the hit', async () => {
    await addRedirect('/old', '/new');
    expect(await digest(() => resolveMissing('/OLD/'))).toBe('NEXT_REDIRECT;replace;/new;308;');
    const [row] = await t.db.select().from(seoRedirect).where(eq(seoRedirect.fromPath, '/old'));
    expect(row!.hits).toBe(1);
    expect(row!.lastHitAt).toBeInstanceOf(Date);
  });
});

describe('404 log', () => {
  it('resolveMissing logs the path and renders not-found', async () => {
    expect(await digest(() => resolveMissing('/gone', 'https://ref.example.org/page?x=1'))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    await logNotFound('/Gone/', 'https://ref.example.org/page');
    await logNotFound('/gone', 'https://other.example.org/a');
    const [row] = await t.db.select().from(seoNotFound);
    expect(row).toMatchObject({ path: '/gone', hits: 3, referrers: ['other.example.org/a', 'ref.example.org/page'] });
  });

  it('skips scanner probes and fixes a 404 with one redirect', async () => {
    expect(await logNotFound('/wp-login.php')).toBe(false);
    expect(await logNotFound('/.env')).toBe(false);
    await logNotFound('/old-page');
    await fixNotFound('/old-page', '/new-page', null);
    const [row] = await t.db.select().from(seoNotFound);
    const [redirect] = await t.db.select().from(seoRedirect);
    expect(redirect).toMatchObject({ fromPath: '/old-page', toPath: '/new-page', source: 'not_found_fix' });
    expect(row!.fixedRedirectId).toBe(redirect!.id);
  });

  it('prunes stale low-hit rows', async () => {
    await logNotFound('/stale');
    await logNotFound('/recent');
    await t.db.update(seoNotFound).set({ lastAt: new Date(Date.now() - 40 * 86_400_000) }).where(eq(seoNotFound.path, '/stale'));
    expect(await pruneNotFound()).toBe(1);
    expect((await t.db.select().from(seoNotFound)).map((r) => r.path)).toEqual(['/recent']);
  });
});

describe('page meta overrides', () => {
  it('override wins in pageMetadata and normalises paths', async () => {
    await savePageMeta({ path: '/About/', title: 'Our story', description: 'Who we are', noindex: true, canonical: null, ogMediaId: null }, null);
    expect((await getPageMeta('/about'))?.title).toBe('Our story');
    const m = await pageMetadata({ title: 'About', description: 'x', path: '/about' });
    expect(m.title).toEqual({ absolute: 'Our story | Example Store' });
    expect(m.robots).toEqual({ index: false, follow: true });
    const plain = await pageMetadata({ title: 'Contact', description: 'x', path: '/contact' });
    expect(plain.title).toEqual({ absolute: 'Contact | Example Store' });
  });
});

describe('sitemaps from module sources', () => {
  const source = (name: string, entries: () => Promise<{ path: string; lastModified?: string }[]>): SitemapSource & { moduleId: string } => ({
    name,
    moduleId: 'test',
    entries: async () => entries,
  });

  beforeEach(async () => {
    await addRedirect('/plant/renamed', '/plant/mango');
    await savePageMeta({ path: '/hidden', title: null, description: null, noindex: true, canonical: null, ogMediaId: null }, null);
    configureSeo({
      site: SITE,
      registry: {
        list: () => [
          source('pages', async () => [{ path: '/about', lastModified: '2026-10-01T00:00:00Z' }, { path: '/hidden' }, { path: '/about/' }]),
          source('products', async () => [{ path: '/plant/mango', lastModified: '2026-10-05T00:00:00Z' }, { path: '/plant/renamed' }, { path: '/plants?f=x' }]),
          source('empty', async () => []),
          source('broken', async () => {
            throw new Error('source down');
          }),
        ],
      },
      llms: { sections: [{ title: 'How to buy in bulk', body: 'Prices drop from 50 plants.' }], sourceTitles: { products: 'Products' } },
    });
  });

  it('only indexable 200 paths: redirect sources, noindex overrides, queries and duplicates are dropped', async () => {
    const files = await sitemapFiles();
    expect(files.map((f) => [f.name, f.entries.map((e) => e.path)])).toEqual([
      ['broken', []],
      ['empty', []],
      ['pages', ['/about']],
      ['products', ['/plant/mango']],
    ]);
  });

  it('index lists non-empty files; files answer XML or 404', async () => {
    const index = await (await sitemapIndexResponse()).text();
    expect(index).toContain('<loc>https://www.example.com/sitemap/pages.xml</loc><lastmod>2026-10-01T00:00:00.000Z</lastmod>');
    expect(index).toContain('/sitemap/products.xml');
    expect(index).not.toContain('empty');
    const res = await sitemapFileResponse('products.xml');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/xml');
    const body = await res.text();
    expect(body).toContain('<loc>https://www.example.com/plant/mango</loc>');
    expect(body).not.toContain('renamed');
    expect((await sitemapFileResponse('empty.xml')).status).toBe(404);
    expect((await sitemapFileResponse('nope.xml')).status).toBe(404);
    expect((await sitemapFileResponse('../etc.xml')).status).toBe(404);
  });

  it('robots.txt and llms.txt', async () => {
    const robots = await robotsResponse().text();
    expect(robots).toContain('User-agent: ClaudeBot\nAllow: /');
    expect(robots).toContain('Disallow: /checkout');
    expect(robots).toContain('Sitemap: https://www.example.com/sitemap.xml');
    const llms = await (await llmsResponse()).text();
    expect(llms).toContain('# Example Store\n\n> Plants.');
    expect(llms).toContain('## How to buy in bulk\n\nPrices drop from 50 plants.');
    expect(llms).toContain('## Products\n\n- [Mango](https://www.example.com/plant/mango)');
    expect(llms).toContain('## Pages\n\n- [About](https://www.example.com/about)');
  });
});

describe('OG image route', () => {
  it('renders a PNG card for a path, using the host card when given', async () => {
    let asked = '';
    configureSeo({ site: SITE, ogCard: async (path) => ((asked = path), { title: 'Alphonso Mango', subtitle: 'Rs 249', eyebrow: 'Fruit trees' }) });
    const res = await ogResponse(['plant', 'alphonso-mango']);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const png = Buffer.from(await res.arrayBuffer());
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(asked).toBe('/plant/alphonso-mango');
    expect((await ogResponse(['..', 'x'])).status).toBe(404);
  });
});

describe('seed hook', () => {
  it('imports active legacy redirects once; a second run changes nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wp09-seed-'));
    writeFileSync(
      join(dir, 'redirects.json'),
      JSON.stringify({
        version: 1,
        records: [
          { from: '/product-category/fruit/', to_sku: null, to_path: '/plants/fruiting-trees', code: 301, status: 'active' },
          { from: '/product/old-mango/', to_sku: 'SKU-1', to_path: null, code: 301, status: 'pending' },
        ],
      }),
    );
    const log = { info: () => undefined, warn: () => undefined, error: () => undefined };
    const ctx = { seedDir: dir, mediaDir: dir, dryRun: false, log };
    expect(await runSeed(ctx)).toMatchObject({ inserted: 1, skipped: 1 });
    expect(await runSeed(ctx)).toMatchObject({ inserted: 0, skipped: 2 });
    const [row] = await t.db.select().from(seoRedirect);
    expect(row).toMatchObject({ fromPath: '/product-category/fruit', toPath: '/plants/fruiting-trees', source: 'legacy_import' });
  });
});

describe('admin actions and the product SEO tab', () => {
  it('permission-gated form actions redirect back with a result code', async () => {
    setAuthProvider(async () => staff([]));
    const form = (o: Record<string, string>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(o)) f.set(k, v);
      return f;
    };
    expect(await digest(() => addRedirectForm(form({ from: '/a', to: '/b' })))).toContain('/admin/seo?error=forbidden');
    expect(await t.db.select().from(seoRedirect)).toHaveLength(0);

    setAuthProvider(async () => staff(['content.write']));
    expect(await digest(() => addRedirectForm(form({ from: '/a', to: '/b', statusCode: '301' })))).toContain('/admin/seo?saved=1');
    expect(await digest(() => addRedirectForm(form({ from: '/b', to: '/a', statusCode: '301' })))).toContain('error=to-loop');
    expect(await digest(() => addRedirectForm(form({ from: '/c', to: '/d', back: 'https://evil.example' })))).toContain('/admin/seo?saved=1');
    expect(await digest(() => savePageMetaForm(form({ path: '/about', title: 'T', description: '', canonical: '', ogMediaId: '', noindex: 'on' })))).toContain('saved=1');
    const [meta] = await t.db.select().from(seoPageMeta);
    expect(meta).toMatchObject({ path: '/about', title: 'T', description: null, noindex: true, updatedBy: '0192a000-0000-7000-8000-000000000001' });
  });

  it('SEO tab shows the search preview and redirects into the product', async () => {
    configureSeo({
      site: SITE,
      entitySeo: async (_kind, id) => (id === 'p1' ? { path: '/plant/mango', title: 'Mango sapling', description: 'Grafted mango.', noindex: false } : null),
    });
    await addRedirect('/product/mango-old', '/plant/mango');
    const html = renderToStaticMarkup(await SeoProductTab({ productId: 'p1' }));
    expect(html).toContain('https://www.example.com/plant/mango');
    expect(html).toContain('Mango sapling | Example Store');
    expect(html).toContain('/product/mango-old');
    expect(renderToStaticMarkup(await SeoProductTab({ productId: null }))).toContain('Save the product first');
  });
});
