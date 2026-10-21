// Real Postgres 17: trgm search, index source, query log, route handlers.
import { readFileSync } from 'node:fs';
import { createTestDb, TEST_NOW, type TestDb } from '@ecomkit/core/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FACET_CONFIG, computeView, loadIndex, parseUrlState, scopeBits } from '../src/domain';
import { facetsHandler, logHandler } from '../src/server/handlers';
import { buildIndexFromDb, facetPageProps } from '../src/server/index-cache';
import { logSearch, queryStats, zeroFilterStats } from '../src/server/log';
import { searchProducts } from '../src/server/search';

const sqlFile = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const uuid = (n: number) => `00000000-0000-7000-8000-${n.toString().padStart(12, '0')}`;

let t: TestDb;

interface P {
  n: number;
  slug: string;
  name: string;
  kn?: string;
  sci?: string;
  aliases?: string[];
  kind?: string;
  status?: string;
  override?: string | null;
  size?: string;
  drought?: string;
  best?: boolean;
  spacing?: Record<string, unknown>;
  price?: number;
  onHand?: number;
  published?: string | null;
  deleted?: boolean;
}

const products: P[] = [
  { n: 1, slug: 'mango-alphonso', name: 'Mango Alphonso', kn: 'ಮಾವು ಆಲ್ಫೋನ್ಸೋ', sci: 'Mangifera indica', aliases: ['aam', 'maavu', 'hapus'], size: 'L', drought: 'moderate', best: true, spacing: { food_forest: [20, 20], commercial: [25, 25], miyawaki: null }, price: 45000, onHand: 30 },
  { n: 2, slug: 'mango', name: 'Mango', kn: 'ಮಾವು', sci: 'Mangifera indica', aliases: ['aam'], size: 'L', drought: 'moderate', spacing: { food_forest: [20, 20] }, price: 25000, onHand: 0 },
  { n: 3, slug: 'sapota', name: 'Sapota', kn: 'ಸಪೋಟ', sci: 'Manilkara zapota', aliases: ['chikku', 'chiku'], size: 'M', drought: 'high', price: 18000, onHand: 5 },
  { n: 4, slug: 'red-sandalwood', name: 'Red Sandalwood', kn: 'ರಕ್ತಚಂದನ', sci: 'Pterocarpus santalinus', aliases: ['red sanders'], size: 'L', drought: 'high', price: 30000, onHand: 12 },
  { n: 5, slug: 'teak', name: 'Teak', kn: 'ತೇಗ', sci: 'Tectona grandis', aliases: ['saagwan'], size: 'L', drought: 'high', status: 'draft', price: 9000, onHand: 3 },
  { n: 6, slug: 'neem-cake', name: 'Neem Cake 5 kg', kind: 'input', price: 32000, onHand: 40 },
  { n: 7, slug: 'hidden-guava', name: 'Guava Hidden', override: 'hidden', price: 10000, onHand: 1 },
  { n: 8, slug: 'future-jamun', name: 'Jamun Future', published: '2099-01-01T00:00:00Z', price: 10000, onHand: 1 },
  { n: 9, slug: 'deleted-amla', name: 'Amla Deleted', deleted: true, price: 10000, onHand: 1 },
  { n: 10, slug: 'percent-50', name: 'Growth 50% Mix', kind: 'input', override: 'available', price: 5000 },
];

beforeAll(async () => {
  process.env.INTERNAL_SECRET ??= 'test-secret-test-secret-test-secret-0123';
  t = await createTestDb('wp-05-server', { schemas: ['core', 'search'] });
  await t.pool.query(sqlFile('./sql/catalog.sql'));
  await t.pool.query(sqlFile('../sql/trgm.sql'));
  const tagId = uuid(900);
  await t.pool.query(`insert into catalog_tag (id, slug, name, kind) values ($1, 'native', 'Native species', 'trait')`, [tagId]);
  for (const p of products) {
    const id = uuid(p.n);
    await t.pool.query(
      `insert into catalog_product (id, kind, slug, name, name_kn, scientific_name, search_aliases, status, availability_override, size_class, drought_tolerance, is_best_seller, spacing_ft, published_at, deleted_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [id, p.kind ?? 'plant', p.slug, p.name, p.kn ?? null, p.sci ?? null, p.aliases ?? [], p.status ?? 'active', p.override ?? null, p.size ?? null, p.drought ?? null, p.best ?? false, p.spacing ? JSON.stringify(p.spacing) : null, p.published === undefined ? '2026-01-01T00:00:00Z' : p.published, p.deleted ? '2026-01-02T00:00:00Z' : null],
    );
    const vid = uuid(100 + p.n);
    await t.pool.query(`insert into catalog_variant (id, product_id, label, is_default) values ($1, $2, 'Default', true)`, [vid, id]);
    if (p.price != null) await t.pool.query(`insert into pricing_price (variant_id, price_paise) values ($1, $2)`, [vid, p.price]);
    if (p.onHand != null) await t.pool.query(`insert into inventory_level (variant_id, on_hand, reserved) values ($1, $2, 0)`, [vid, p.onHand]);
  }
  await t.pool.query(`insert into catalog_product_tag (product_id, tag_id) values ($1, $2), ($3, $2)`, [uuid(3), tagId, uuid(4)]);
  // Category = top-level collection (a child collection counts as its parent); subcategory is free text.
  await t.pool.query(`insert into catalog_collection (id, slug, name, parent_id) values ($1, 'fruiting', 'Fruiting trees', null), ($2, 'desi', 'Desi', $1)`, [uuid(910), uuid(911)]);
  await t.pool.query(`update catalog_product set collection_id = $1, subcategory = 'Desi' where slug = 'mango-alphonso'`, [uuid(911)]);
  await t.pool.query(`update catalog_product set collection_id = $1, subcategory = 'Exotic' where slug = 'sapota'`, [uuid(910)]);
}, 120_000);

afterAll(async () => {
  await t?.close();
});

const slugs = async (q: string) => (await searchProducts(t.db, q)).map((h) => h.slug);

describe('searchProducts (trgm ILIKE)', () => {
  it('matches English names, name-prefix first', async () => {
    expect(await slugs('mango')).toEqual(['mango', 'mango-alphonso']);
    expect(await slugs('MANGO alph')).toEqual(['mango-alphonso']);
  });
  it('matches Kannada, scientific names and romanised aliases', async () => {
    expect(await slugs('ಮಾವು')).toEqual(['mango', 'mango-alphonso'].sort());
    expect(await slugs('santalinus')).toEqual(['red-sandalwood']);
    expect(await slugs('chikku')).toEqual(['sapota']);
    expect(await slugs('red sanders')).toEqual(['red-sandalwood']);
    expect(await slugs('hapus')).toEqual(['mango-alphonso']);
  });
  it('excludes drafts, hidden, deleted and future-published products', async () => {
    expect(await slugs('teak')).toEqual([]);
    expect(await slugs('guava')).toEqual([]);
    expect(await slugs('amla')).toEqual([]);
    expect(await slugs('jamun')).toEqual([]);
  });
  it('treats LIKE wildcards literally and ignores one-character queries', async () => {
    expect(await slugs('50%')).toEqual(['percent-50']);
    expect(await slugs('%')).toEqual([]);
    expect(await slugs('_')).toEqual([]);
    expect(await slugs('m')).toEqual([]);
  });
  it('the trgm expression index exists and serves the query', async () => {
    const { rows } = await t.pool.query(`select indexdef from pg_indexes where indexname = 'search_catalog_product_haystack_trgm'`);
    expect(rows[0]?.indexdef).toContain('gin_trgm_ops');
    const client = await t.pool.connect();
    try {
      await client.query('set enable_seqscan = off');
      const plan = await client.query(`explain select id from catalog_product p where search_haystack(p.name, p.name_kn, p.scientific_name, p.search_aliases) ilike '%mango%' and search_haystack(p.name, p.name_kn, p.scientific_name, p.search_aliases) ilike '%alph%'`);
      expect(plan.rows.map((r) => r['QUERY PLAN']).join('\n')).toContain('search_catalog_product_haystack_trgm');
    } finally {
      await client.query('reset enable_seqscan');
      client.release();
    }
  });
});

describe('index source from the catalog tables', () => {
  it('builds the facet index: visible products only, recommendation order, price, stock, models, tags', async () => {
    const index = await buildIndexFromDb(t.db, undefined, TEST_NOW);
    const bySlug = Object.fromEntries(index.docs.map((d, i) => [d.s, i]));
    expect(Object.keys(bySlug).sort()).toEqual(['mango', 'mango-alphonso', 'neem-cake', 'percent-50', 'red-sandalwood', 'sapota']);
    expect(index.docs[0]!.s).toBe('mango-alphonso'); // bestseller first
    expect(index.docs[bySlug['mango-alphonso']!]).toEqual({ s: 'mango-alphonso', k: 'plant', n: 'Mango Alphonso', l: 'ಮಾವು ಆಲ್ಫೋನ್ಸೋ', c: 'Mangifera indica', a: ['aam', 'maavu', 'hapus'] });
    expect(index.numeric.price![bySlug.sapota!]).toBe(18000);
    expect(index.facets.tag!.values.native!.label).toBe('Native species');

    const ix = loadIndex(index);
    const view = (values: Record<string, string[]>) => computeView(ix, DEFAULT_FACET_CONFIG, { values, ranges: {} }).ids.map((id) => index.docs[ix.pos.get(id)!]!.s);
    expect(view({ stock: ['in'] }).sort()).toEqual(['mango-alphonso', 'neem-cake', 'percent-50', 'red-sandalwood', 'sapota']); // mango has 0 on hand; override available wins
    expect(view({ model: ['commercial'] })).toEqual(['mango-alphonso']); // null spacing (miyawaki) is not a model
    expect(view({ size: ['large'], drought: ['high'] })).toEqual(['red-sandalwood']);
    expect(view({ tag: ['native'] }).sort()).toEqual(['red-sandalwood', 'sapota']);
    expect(index.facets.cat!.values.fruiting!.label).toBe('Fruiting trees');
    expect(index.facets.sub!.values.exotic!.label).toBe('Exotic');
    expect(view({ cat: ['fruiting'] }).sort()).toEqual(['mango-alphonso', 'sapota']);
    expect(view({ sub: ['desi'] })).toEqual(['mango-alphonso']);
  });

  it('facetPageProps scopes facets to search hits in relevance order and parses the URL', async () => {
    const index = await buildIndexFromDb(t.db, undefined, TEST_NOW);
    const hits = await searchProducts(t.db, 'mango');
    const props = facetPageProps({ index, searchParams: { q: 'mango', f: 'stock:' }, scopeIds: hits.map((h) => h.id), defaultSort: 'relevance' });
    expect(props.url.q).toBe('mango');
    expect(props.url.sort).toBe('relevance');
    expect(props.view.ids).toEqual(hits.map((h) => h.id));
    const inScope = computeView(loadIndex(index), DEFAULT_FACET_CONFIG, parseUrlState({}, DEFAULT_FACET_CONFIG).state, { scope: scopeBits(loadIndex(index), props.scopeIds) });
    expect(inScope.total).toBe(1); // default in-stock filter leaves only the alphonso
  });
});

describe('/facets.json handler', () => {
  it('serves the index with an ETag and answers 304 when unchanged', async () => {
    const index = await buildIndexFromDb(t.db, undefined, TEST_NOW);
    const GET = facetsHandler(async () => index);
    const res = await GET(new Request('http://x/facets.json'));
    expect(res.status).toBe(200);
    const etag = res.headers.get('etag')!;
    expect(((await res.json()) as { ids: string[] }).ids).toHaveLength(6);
    const again = await GET(new Request('http://x/facets.json', { headers: { 'if-none-match': etag } }));
    expect(again.status).toBe(304);
  });
});

describe('query log', () => {
  it('logs normalised queries and filter-only zero results; reports top and zero-result queries', async () => {
    await logSearch(t.db, { q: '  Mango ', results: 2 });
    await logSearch(t.db, { q: 'mango', results: 2 });
    await logSearch(t.db, { q: 'Rudraksha', results: 0 });
    await logSearch(t.db, { q: '', results: 0, filters: 'size:small;stock:' });
    await logSearch(t.db, { q: '', results: 3 }); // nothing to log
    const top = await queryStats(t.db, {});
    expect(top.map((r) => [r.q, r.searches])).toEqual([
      ['mango', 2],
      ['rudraksha', 1],
    ]);
    expect((await queryStats(t.db, { zeroOnly: true })).map((r) => r.q)).toEqual(['rudraksha']);
    expect(await zeroFilterStats(t.db)).toEqual([{ filters: 'size:small;stock:', times: 1 }]);
    const { rows } = await t.pool.query(`select count(*)::int as n from search_query_log`);
    expect(rows[0].n).toBe(4);
  });

  it('POST /api/search/log validates, logs and rate-limits per IP', async () => {
    const POST = logHandler();
    const req = (body: string, ip = '203.0.113.9') => new Request('http://x/api/search/log', { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-real-ip': ip } });
    expect((await POST(req('not json'))).status).toBe(400);
    expect((await POST(req(JSON.stringify({ results: -1 })))).status).toBe(400);
    expect((await POST(req('x'.repeat(3000)))).status).toBe(413);
    expect((await POST(req(JSON.stringify({ q: '', results: 0, filters: 'model:boundary' })))).status).toBe(204);
    expect((await POST(req(JSON.stringify({ q: '', results: 0, filters: '<script>' })))).status).toBe(400);
    expect((await POST(req(JSON.stringify({ q: '', results: 3, filters: 'model:boundary' })))).status).toBe(400);
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await POST(req(JSON.stringify({ q: 'x', results: 0 }), '198.51.100.1'))).status);
    expect(statuses.filter((s) => s === 204)).toHaveLength(30);
    expect(statuses.at(-1)).toBe(429);
    const { rows } = await t.db.execute<{ n: number }>(sql`select count(*)::int as n from search_query_log where filters->>'f' = 'model:boundary'`);
    expect(rows[0]!.n).toBe(1);
  });
});
