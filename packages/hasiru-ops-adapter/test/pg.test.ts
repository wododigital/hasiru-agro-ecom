import { randomBytes } from 'node:crypto';
import type { TestDb } from '@ecomkit/core/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { grantScript, PG_ALLOWLIST, PG_INVENTORY_SQL } from '../src/domain';
import { checkPgUrl, pullPgPage, withReadOnly } from '../src/server';
import { opsDb } from './helpers';

// A local stand-in for the operations database: the real `items` and `stock_batches` shapes (plus columns we must
// never read), 2,345 items, and the ecom_sync role created with exactly the script from the spec.
let t: TestDb;
const role = `ecomkit_wp27_sync_${randomBytes(4).toString('hex')}`;
let roleUrl: string;
const ITEMS = 2345;

const itemId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

beforeAll(async () => {
  t = await opsDb('ops-pg', []);
  await t.pool.query(`
    create table items (
      id uuid primary key, name text not null, variety text, hsn text, unit text, default_rate numeric(12,2), default_weight numeric(12,3),
      gst_rate numeric(5,2), is_active boolean not null default true, category text not null default 'plant', size_grade text,
      reorder_level numeric(12,2), track_stock boolean not null default true, vendor_id uuid, cost_rate numeric(12,2), created_at timestamptz not null default now());
    create table stock_batches (
      id uuid primary key default gen_random_uuid(), item_id uuid not null references items (id), location_id uuid not null, batch_code text not null unique,
      source text not null, qty_initial numeric(12,2) not null, qty_available numeric(12,2) not null, unit_cost numeric(12,2) not null default 0,
      batch_date date not null, expected_ready date, status text not null default 'growing', notes text, created_at timestamptz not null default now());`);
  // Item n: ready batch with n % 40 plants, plus a growing batch due in 20 days for every 5th item; item 7 inactive.
  await t.pool.query(
    `insert into items (id, name, variety, size_grade, cost_rate, is_active)
     select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'Plant ' || g, case when g % 2 = 0 then 'Grafted' end, case when g % 3 = 0 then '2 ft' end, 45.50, g <> 7
     from generate_series(1, $1) g`,
    [ITEMS],
  );
  await t.pool.query(
    `insert into stock_batches (item_id, location_id, batch_code, source, qty_initial, qty_available, batch_date, status, unit_cost)
     select i.id, gen_random_uuid(), 'R-' || g, 'grown', 100, g % 40, current_date - 30, 'ready', 12.5
     from generate_series(1, $1) g join items i on i.id = ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid`,
    [ITEMS],
  );
  await t.pool.query(
    `insert into stock_batches (item_id, location_id, batch_code, source, qty_initial, qty_available, batch_date, expected_ready, status)
     select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, gen_random_uuid(), 'G-' || g, 'grown', 50, 50, current_date, (now() at time zone 'Asia/Kolkata')::date + 20, 'growing'
     from generate_series(5, $1, 5) g`,
    [ITEMS],
  );
  // Row level security as in the operations database: staff-only policies that our role does not pass.
  await t.pool.query(`
    alter table items enable row level security; alter table stock_batches enable row level security;
    create policy items_staff_all on items for all using (false); create policy stock_batches_staff_all on stock_batches for all using (false);`);
  await t.pool.query(grantScript(role).replace("'<set-by-ops-team>'", "'test-only-password'"));
  const u = new URL(t.url);
  u.username = role;
  u.password = 'test-only-password';
  u.searchParams.set('sslmode', 'disable');
  roleUrl = u.toString();
}, 120_000);

afterAll(async () => {
  await t?.pool.query(`drop policy if exists ${role}_read on items; drop policy if exists ${role}_read on stock_batches`).catch(() => undefined);
  await t?.pool.query(`drop owned by ${role}`).catch(() => undefined);
  await t?.pool.query(`drop role if exists ${role}`).catch(() => undefined);
  await t?.close();
});

describe('read-only role', () => {
  it('pages every active item past the 1000-row cap with keyset cursors', async () => {
    const all = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await pullPgPage(roleUrl, cursor);
      all.push(...page.items);
      cursor = page.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(all).toHaveLength(ITEMS - 1);
    expect(new Set(all.map((i) => i.erpItemId)).size).toBe(ITEMS - 1);
    expect(all.find((i) => i.erpItemId === itemId(7))).toBeUndefined();
    expect(all.find((i) => i.erpItemId === itemId(6))).toMatchObject({ name: 'Plant 6', variety: 'Grafted 2 ft', available: 6, readyInDays: null, costPaise: 4550, sku: null });
    // Item 40: no ready stock, a growing batch due in 20 days -> preorder.
    expect(all.find((i) => i.erpItemId === itemId(40))).toMatchObject({ available: 0, readyInDays: 20 });
    expect(all.find((i) => i.erpItemId === itemId(80))?.readyInDays).toBe(20);
    expect(all.find((i) => i.erpItemId === itemId(81))).toMatchObject({ available: 1, readyInDays: null });
  });

  it('the query touches only allowlisted columns (the role can read nothing else)', async () => {
    const refs = [...PG_INVENTORY_SQL.matchAll(/\b([ib])\.([a-z_]+)/g)].map(([, a, c]) => `${a === 'i' ? 'items' : 'stock_batches'}.${c}`);
    const allowed = new Set(Object.entries(PG_ALLOWLIST).flatMap(([tbl, cols]) => cols.map((c) => `${tbl}.${c}`)));
    expect(refs.filter((r) => !allowed.has(r))).toEqual([]);
    const c = new pg.Client({ connectionString: roleUrl });
    await c.connect();
    try {
      await expect(c.query('select unit_cost from stock_batches limit 1')).rejects.toThrow(/permission denied/);
      await expect(c.query('select default_rate from items limit 1')).rejects.toThrow(/permission denied/);
      await expect(c.query('select * from items limit 1')).rejects.toThrow(/permission denied/);
    } finally {
      await c.end();
    }
  });

  it('the role refuses UPDATE, and the adapter connection is read-only even for a stronger role', async () => {
    const c = new pg.Client({ connectionString: roleUrl });
    await c.connect();
    try {
      await expect(c.query("update items set name = 'x' where id = $1", [itemId(1)])).rejects.toThrow(/read-only transaction|permission denied/);
      await c.query('set default_transaction_read_only = off');
      await expect(c.query("update items set name = 'x' where id = $1", [itemId(1)])).rejects.toThrow(/permission denied/);
    } finally {
      await c.end();
    }
    const owner = new URL(t.url);
    owner.searchParams.set('sslmode', 'disable');
    await expect(withReadOnly(owner.toString(), (cl) => cl.query("update items set name = 'x' where id = $1", [itemId(1)]))).rejects.toThrow(/read-only transaction/);
    expect((await t.pool.query('select name from items where id = $1', [itemId(1)])).rows[0]).toEqual({ name: 'Plant 1' });
  });

  it('refuses plaintext connections to a remote host', () => {
    expect(() => checkPgUrl('postgres://u:p@db.example.com:5432/postgres?sslmode=disable')).toThrow(/TLS is required/);
    expect(checkPgUrl('postgres://u:p@db.example.com:5432/postgres?sslmode=verify-full')).toEqual({ ssl: { rejectUnauthorized: true } });
    // No sslmode, ssl=false, prefer or allow: a remote host still gets verified TLS; loopback stays plain.
    for (const q of ['', '?ssl=false', '?sslmode=prefer', '?sslmode=allow', '?sslmode=require']) {
      expect(checkPgUrl(`postgres://u:p@db.example.com:5432/postgres${q}`)).toEqual({ ssl: { rejectUnauthorized: true } });
    }
    expect(checkPgUrl('postgres://u:p@localhost:5433/postgres')).toEqual({ ssl: false });
    expect(() => checkPgUrl('https://example.com')).toThrow(/postgres/);
  });
});
