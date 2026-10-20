// Read-only Postgres transport: inventory in only, through the ecom_sync role (SELECT on allowlisted columns).
import pg from 'pg';
import type { ErpInventoryItem } from '@ecomkit/core/contracts';
import { PG_INVENTORY_SQL, pgRowToItem, type PgInventoryRow } from '../domain';

export const PG_PAGE_SIZE = 1000;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export class PgTransportError extends Error {
  override name = 'PgTransportError';
}

/**
 * TLS is required off the local machine: `sslmode=disable` is refused unless the host is loopback, and for any
 * other host the client is given `ssl: { rejectUnauthorized: true }` whatever the URL says (`ssl=false`, `prefer`,
 * `allow` or nothing cannot downgrade the link). Returns the pg client options to use.
 */
export function checkPgUrl(url: string): { ssl: { rejectUnauthorized: true } | false } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new PgTransportError('pg connection string is not a URL');
  }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') throw new PgTransportError('pg connection string must start with postgres://');
  const loopback = LOOPBACK.has(u.hostname);
  if (u.searchParams.get('sslmode') === 'disable' && !loopback) throw new PgTransportError('TLS is required: remove sslmode=disable');
  return { ssl: loopback ? false : { rejectUnauthorized: true } };
}

/**
 * Runs `fn` inside a READ ONLY transaction with a 10 s statement timeout on a short-lived connection (works through
 * transaction-mode poolers too, where session settings do not stick). Always rolls back: nothing is ever written.
 */
export async function withReadOnly<T>(url: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const { ssl } = checkPgUrl(url);
  const client = new pg.Client({ connectionString: url, ssl, statement_timeout: 10_000, query_timeout: 15_000, connectionTimeoutMillis: 10_000, application_name: 'ecomkit-erp-sync' });
  await client.connect();
  try {
    await client.query('begin transaction read only');
    await client.query("set local statement_timeout = '10s'");
    return await fn(client);
  } finally {
    await client.query('rollback').catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

/** One keyset page (stable order by item id, so the 1000-row cap of the hosted database never truncates a pull). */
export async function pullPgPage(url: string, cursor: string | null, options: { now?: Date; pageSize?: number } = {}): Promise<{ items: ErpInventoryItem[]; nextCursor: string | null }> {
  const pageSize = options.pageSize ?? PG_PAGE_SIZE;
  if (cursor !== null && !/^[0-9a-f-]{36}$/i.test(cursor)) throw new PgTransportError('invalid cursor');
  const rows = await withReadOnly(url, async (c) => (await c.query<PgInventoryRow>(PG_INVENTORY_SQL, [cursor, pageSize])).rows);
  const now = options.now ?? new Date();
  return { items: rows.map((r) => pgRowToItem(r, now)), nextCursor: rows.length === pageSize ? rows[rows.length - 1]!.id : null };
}
