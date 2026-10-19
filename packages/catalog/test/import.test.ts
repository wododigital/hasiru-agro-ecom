import { randomBytes } from 'node:crypto';
import { createTestDb, type TestDb } from '@ecomkit/core/testing';
import { eq, sql } from 'drizzle-orm';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { catalogCollection, catalogFaq, catalogProduct, catalogProductMedia, catalogTag, catalogVariant } from '../src/schema';
import { configureCatalog } from '../src/server/runtime';
import { exportCsv, exportSheet, importCsv, importSeed, importSheet } from '../src/server/import';
import { SHEET_DATA_START, SHEET_NAME } from '../src/domain/sheet';
import { fakeMediaIds, writeSeedDir } from './fixtures';

let t: TestDb;
let seedDir: string;
const actor = { actorId: null, actorType: 'system' as const };

beforeAll(async () => {
  process.env.INTERNAL_SECRET = 'z'.repeat(40);
  process.env.SETTINGS_MASTER_KEY = `1:${randomBytes(32).toString('base64')}`;
  t = await createTestDb('wp-04-import', { schemas: ['core', 'catalog'] });
  configureCatalog({ resolveMediaIds: fakeMediaIds() });
  seedDir = await writeSeedDir();
});

afterAll(async () => {
  await t?.close();
});

const count = async (table: typeof catalogProduct | typeof catalogVariant) => (await t.db.select({ n: sql<number>`count(*)::int` }).from(table))[0]!.n;

describe('importSeed', () => {
  it('a dry run writes nothing', async () => {
    const r = await importSeed({ seedDir, dryRun: true });
    expect(r.inserted).toBeGreaterThan(0);
    expect(r.notes).toContain('dry run: rolled back');
    expect(await count(catalogProduct)).toBe(0);
  });

  it('loads products, variants, collections, tags, FAQs and media links', async () => {
    const r = await importSeed({ seedDir });
    expect(r.inserted).toBeGreaterThan(0);
    expect(await count(catalogProduct)).toBe(6);
    expect(await count(catalogVariant)).toBe(6);
    const slugs = (await t.db.select({ slug: catalogCollection.slug }).from(catalogCollection)).map((c) => c.slug).sort();
    // Top collections per code, children per subcategory; "&" is a separator, never the word "and".
    expect(slugs).toEqual(['biomass-support', 'desi', 'exotic', 'fruiting', 'input', 'native-medicinal', 'other', 'timber']);
    const tags = await t.db.select({ slug: catalogTag.slug, kind: catalogTag.kind }).from(catalogTag);
    expect(tags).toEqual(expect.arrayContaining([
      { slug: 'drought-tolerant', kind: 'trait' },
      { slug: 'nitrogen-fixing', kind: 'trait' },
      { slug: 'medicinal', kind: 'use' },
    ]));
    // The seed's own "Nitrogen fixer" tag folds into the derived trait instead of a duplicate.
    expect(tags.find((x) => x.slug === 'nitrogen-fixer')).toBeUndefined();
    const [mango] = await t.db.select().from(catalogProduct).where(eq(catalogProduct.sku, 'P-0001'));
    expect(mango!.descriptionHtml).toBe('<p>Sweet <strong>fruit</strong>.</p>');
    expect(mango!.bearingYearsMin).toBe(3);
    expect(mango!.bearingYearsMax).toBe(4);
    expect(mango!.spacingFt).toEqual({ food_forest: [18, 18], commercial: [18, 18] });
    expect(mango!.publishedAt).not.toBeNull();
    const [teak] = await t.db.select().from(catalogProduct).where(eq(catalogProduct.sku, 'P-0002'));
    expect(teak!.timberRotationYears).toBe(20);
    expect(teak!.attributes).toEqual({ timber_rotation_years: '20-25' });
    const [draft] = await t.db.select().from(catalogProduct).where(eq(catalogProduct.sku, 'P-0005'));
    expect(draft!.status).toBe('draft');
    expect(draft!.publishedAt).toBeNull();
    expect(draft!.noindex).toBe(true);
    const media = await t.db.select().from(catalogProductMedia).where(eq(catalogProductMedia.productId, mango!.id));
    expect(media.map((m) => m.role).sort()).toEqual(['fruit', 'main']);
    const faqs = await t.db.select({ key: catalogFaq.key, status: catalogFaq.status }).from(catalogFaq);
    expect(faqs).toEqual(expect.arrayContaining([
      { key: 'P-0001:faq-1', status: 'published' },
      { key: 'P-0001:faq-2', status: 'client_only' },
      { key: 'general-001', status: 'published' },
      { key: 'general-002', status: 'client_only' },
    ]));
  });

  it('is idempotent: a second run changes zero rows', async () => {
    const before = await t.db.select({ id: catalogProduct.id, updatedAt: catalogProduct.updatedAt }).from(catalogProduct);
    const r = await importSeed({ seedDir });
    expect(r.inserted).toBe(0);
    expect(r.updated).toBe(0);
    expect(r.skipped).toBeGreaterThan(0);
    const after = await t.db.select({ id: catalogProduct.id, updatedAt: catalogProduct.updatedAt }).from(catalogProduct);
    expect(after).toEqual(before);
  });

  it('applies a changed record as one update', async () => {
    const { seedProducts, seedInputs, seedFaqs } = await import('./fixtures');
    const changed = seedProducts.map((p) => (p.sku === 'P-0002' ? { ...p, name_kn: 'ತೇಗ' } : p));
    const dir = await writeSeedDir(changed, seedInputs, seedFaqs);
    const r = await importSeed({ seedDir: dir });
    expect(r).toMatchObject({ inserted: 0, updated: 1 });
    expect((await importSeed({ seedDir: dir })).updated).toBe(0);
  });
});

describe('admin import and export', () => {
  it('the plant data sheet round-trips unchanged, then applies an edited cell and a new row', async () => {
    const bytes = await exportSheet();
    const wb = XLSX.read(bytes, { type: 'array' });
    const ws = wb.Sheets[SHEET_NAME]!;
    const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, { header: 1, defval: null });
    expect(rows.length).toBe(SHEET_DATA_START + 5); // five plants (draft included), no inputs
    const same = await importSheet(bytes, { actorId: null, actorType: 'staff' });
    expect(same).toEqual({ created: 0, updated: 0, unchanged: 5, errors: [] });

    const mangoRow = rows.findIndex((r) => r[1] === 'Mango');
    rows[mangoRow]![17] = 600; // rainfall min
    rows.push([null, 'Jamun', 'Seedless', null, 'Large tree', 'Desi fruits', null, null, 'No', 'High', 'Seeded', 28, 10, 42, 60, 30, 85, 700, 2000, '20 x 20', '-', '20 x 20', 15, 5, 5, 8, 10]);
    const edited = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(edited, XLSX.utils.aoa_to_sheet(rows), SHEET_NAME);
    const report = await importSheet(XLSX.write(edited, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer, { actorId: null, actorType: 'staff' });
    expect(report).toEqual({ created: 1, updated: 1, unchanged: 4, errors: [] });
    const [mango] = await t.db.select().from(catalogProduct).where(eq(catalogProduct.sku, 'P-0001'));
    expect(mango!.rainfallMin).toBe(600);
    const [jamun] = await t.db.select().from(catalogProduct).where(eq(catalogProduct.slug, 'seedless-jamun'));
    expect(jamun).toMatchObject({ status: 'draft', needsReview: true, spacingFt: { food_forest: [20, 20], commercial: [20, 20], boundary: 15 } });
  });

  it('the CSV round-trips and updates by sku or legacy sku', async () => {
    const csv = await exportCsv();
    expect(csv.split('\n')[0]).toMatch(/^sku,kind,slug,name,/);
    expect(await importCsv(csv, actor)).toMatchObject({ created: 0, updated: 0, errors: [] });
    const legacy = 'SKU,Short description\nOLD-11,Now with a new short text\n';
    expect(await importCsv(legacy, actor)).toMatchObject({ updated: 1, errors: [] });
    const [mango] = await t.db.select().from(catalogProduct).where(eq(catalogProduct.sku, 'P-0001'));
    expect(mango!.shortDescription).toBe('Now with a new short text');
    const bad = 'sku,kind,slug,name\nX-1,plant,Not A Slug!,Broken\n';
    const r = await importCsv(bad, actor);
    expect(r.created).toBe(0);
    expect(r.errors[0]).toMatchObject({ row: 2 });
  });
});

describe('collections.json', () => {
  it('when present it names the collections and products land in the matching child', async () => {
    const { writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const dir = await writeSeedDir();
    const cols = [
      { code: 'fruiting', slug: 'fruiting-trees', name: 'Fruiting Trees', kind: 'plant', position: 1 },
      { code: 'fruiting/desi', slug: 'desi', name: 'Desi', kind: 'plant', parent: 'fruiting', position: 2 },
      { code: 'other', slug: 'other-plants', name: 'Other Plants', kind: 'plant', position: 3 },
      { code: 'other/native-medicinal', slug: 'native-medicinal', name: 'Native & medicinal', kind: 'plant', parent: 'other', position: 4 },
    ];
    await writeFile(join(dir, 'collections.json'), JSON.stringify({ version: 1, records: cols }));
    const db2 = await createTestDb('wp-04-import-cols', { schemas: ['core', 'catalog'] });
    try {
      await importSeed({ seedDir: dir });
      const rows = await db2.db
        .select({ sku: catalogProduct.sku, slug: catalogCollection.slug })
        .from(catalogProduct)
        .leftJoin(catalogCollection, eq(catalogCollection.id, catalogProduct.collectionId));
      const bySku = Object.fromEntries(rows.map((r) => [r.sku, r.slug]));
      expect(bySku).toMatchObject({ 'P-0001': 'desi', 'P-0004': 'native-medicinal', 'P-0003': 'other-plants', 'P-0005': 'fruiting-trees', 'P-0002': null });
    } finally {
      await db2.close();
    }
  });
});
