import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createTestDb, type TestDb } from '@ecomkit/core/testing';
import { sql } from 'drizzle-orm';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn() }));
// DataTable's toolbar island reads the app router; outside Next there is none mounted.
vi.mock('next/navigation', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {}, prefetch: () => {} }),
  usePathname: () => '/admin/products',
  useSearchParams: () => new URLSearchParams(),
}));

import { CollectionsPage, DataGapsPage, FaqsPage, ImportPage, ProductsListPage, TagsPage } from '../src/admin/Pages';
import { ProductCreatePage } from '../src/admin/ProductEditor';
import manifest from '../src/manifest';
import { GET as exportGet } from '../src/routes/export';
import { catalogProduct } from '../src/schema';
import { importSheet } from '../src/server/import';
import { configureCatalog } from '../src/server/runtime';
import { writeSeedDir } from './fixtures';
import { renderHtml, signInAs, STAFF } from './helpers';

let t: TestDb;
let seedDir: string;

beforeAll(async () => {
  process.env.INTERNAL_SECRET = 'z'.repeat(40);
  process.env.SETTINGS_MASTER_KEY = `1:${randomBytes(32).toString('base64')}`;
  t = await createTestDb('wp-04-admin', { schemas: ['core', 'catalog'] });
  configureCatalog({});
  seedDir = await writeSeedDir();
});

afterAll(async () => {
  await t?.close();
});

const noop = { info: () => {}, warn: () => {}, error: () => {} };

describe('manifest hooks', () => {
  it('the seed hook loads the catalog and a second run changes nothing', async () => {
    const run = await manifest.seedHooks[0]!.run();
    const first = await run({ seedDir, mediaDir: '/nonexistent', dryRun: false, log: noop });
    expect(first.inserted).toBeGreaterThan(0);
    const second = await run({ seedDir, mediaDir: '/nonexistent', dryRun: false, log: noop });
    expect([second.inserted, second.updated]).toEqual([0, 0]);
  });

  it('sitemap sources list indexable product and listing paths', async () => {
    const [products, collections] = await Promise.all(manifest.sitemapSources.map(async (s) => (await s.entries())()));
    expect(products!.map((e) => e.path)).toContain('/plant/alphonso-mango');
    expect(products!.map((e) => e.path)).not.toContain('/plant/old-listing-plant');
    expect(collections!.map((e) => e.path)).toEqual(expect.arrayContaining(['/plants', '/inputs', '/plants/fruiting/desi', '/plants/drought-tolerant']));
  });

  it('admin pages and nav stay inside the products band and never under /admin/settings', () => {
    expect(manifest.admin.nav.every((n) => n.order >= 200 && n.order < 300)).toBe(true);
    expect(manifest.admin.pages.every((p) => p.path.startsWith('/admin/') && !p.path.startsWith('/admin/settings'))).toBe(true);
  });
});

describe('admin pages render for staff', () => {
  it.each([
    ['plants list', () => ProductsListPage({ kind: 'plant', searchParams: Promise.resolve({}) }), 'Alphonso Mango'],
    ['inputs list', () => ProductsListPage({ kind: 'input', searchParams: Promise.resolve({ status: 'active' }) }), 'Vermicompost 25 kg'],
    ['new product', () => ProductCreatePage({ kind: 'plant' }), 'Create product'],
    ['collections', () => CollectionsPage(), 'native-medicinal'],
    ['tags', () => TagsPage(), 'Drought tolerant'],
    ['faqs', () => FaqsPage({ searchParams: Promise.resolve({ status: 'client_only' }) }), 'Do I need a permit?'],
    ['data gaps', () => DataGapsPage(), 'Keep, publish or delete?'],
    ['import', () => ImportPage(), 'Plant data sheet (.xlsx)'],
  ])('%s', async (_name, page, text) => {
    signInAs(STAFF);
    expect(await renderHtml(await page())).toContain(text);
  });

  it('pages refuse viewers without the permission', async () => {
    signInAs({ ...STAFF, permissions: ['orders.read'] });
    await expect(ProductsListPage({ kind: 'plant', searchParams: Promise.resolve({}) })).rejects.toThrow(/forbidden/);
  });
});

describe('export route', () => {
  it('returns the sheet and the CSV to staff and 404 to anyone else', async () => {
    signInAs({ kind: 'guest' });
    expect((await exportGet(new Request('http://x/api/catalog/export'))).status).toBe(404);
    signInAs(STAFF);
    const xlsx = await exportGet(new Request('http://x/api/catalog/export?format=xlsx'));
    expect(xlsx.headers.get('content-type')).toMatch(/spreadsheetml/);
    expect(XLSX.read(new Uint8Array(await xlsx.arrayBuffer()), { type: 'array' }).SheetNames).toEqual(['Plant data']);
    const csv = await exportGet(new Request('http://x/api/catalog/export?format=csv'));
    expect(await csv.text()).toMatch(/^sku,kind,slug,name/);
  });
});

// The grower's real file lives only in the main tree (gitignored); when present, its "Plant data" sheet must import cleanly.
const CLIENT_XLSX = '/Users/shyam/Desktop/Claude Dev Projects/hasiru-agro-ecom/latest_products.xlsx';
describe.skipIf(!existsSync(CLIENT_XLSX))('the grower\'s own sheet', () => {
  it('imports every Plant data row without errors (new rows as drafts for review)', async () => {
    await t.db.execute(sql`truncate catalog_product cascade`);
    const report = await importSheet(new Uint8Array(readFileSync(CLIENT_XLSX)), { actorId: null, actorType: 'system' });
    expect(report.errors).toEqual([]);
    expect(report.created).toBeGreaterThanOrEqual(150);
    const [row] = await t.db.select({ n: sql<number>`count(*)::int`, withSpacing: sql<number>`count(*) filter (where spacing_ft <> '{}'::jsonb)::int` }).from(catalogProduct);
    expect(row!.n).toBe(report.created);
    expect(row!.withSpacing).toBeGreaterThan(100);
  });
});
