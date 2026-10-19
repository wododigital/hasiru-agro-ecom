import { sql, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { PgColumn, PgInsertValue, PgTable, PgUpdateSetSource } from 'drizzle-orm/pg-core';
import pg from 'pg';
import type { Db, DbOrTx, Tx } from './types';

export type { Db, DbOrTx, Tx } from './types';

let current: { db: Db; pool: pg.Pool; url: string } | null = null;

/**
 * Points the shared `db` at a database. Runtime code never calls this (the first use connects to
 * DATABASE_URL, the app role); tests call it through `createTestDb`, scripts with the owner URL.
 */
export function configureDb(url: string, options: { max?: number } = {}): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: url, max: options.max ?? 10 });
  const previous = current;
  current = { db: drizzle(pool), pool, url };
  void previous?.pool.end();
  return { db: current.db, pool };
}

export function getDb(): Db {
  if (!current) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    configureDb(url);
  }
  return current!.db;
}

/** Connection string of the shared db (the job queue connects with the same one). */
export function getDbUrl(): string {
  getDb();
  return current!.url;
}

export function getPool(): pg.Pool {
  getDb();
  return current!.pool;
}

export async function closeDb(): Promise<void> {
  const c = current;
  current = null;
  await c?.pool.end();
}

/** The shared Drizzle instance. Connects lazily, so importing it never opens a connection. */
export const db: Db = new Proxy({} as Db, {
  get(_, prop) {
    const real = getDb();
    const value = Reflect.get(real, prop, real) as unknown;
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(real) : value;
  },
});

export function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().transaction(fn);
}

/** `excluded.<column>` for the update half of a multi-row upsert. */
export function excluded(column: PgColumn): SQL {
  return sql.raw(`excluded."${column.name.replace(/"/g, '""')}"`);
}

/**
 * INSERT ... ON CONFLICT DO UPDATE that refuses an empty update set. An upsert with nothing to update
 * silently becomes a plain insert (or a no-op that returns no row), which is the bug this guards.
 */
export async function upsertRequireUpdate<T extends PgTable>(
  dbOrTx: DbOrTx,
  table: T,
  values: PgInsertValue<T> | PgInsertValue<T>[],
  options: { target: PgColumn | PgColumn[]; set: PgUpdateSetSource<T> },
): Promise<T['$inferSelect'][]> {
  if (!options.set || Object.keys(options.set).length === 0) {
    throw new Error('upsertRequireUpdate: the update set is empty, so a conflict would update nothing');
  }
  const rows = Array.isArray(values) ? values : [values];
  if (rows.length === 0) return [];
  return (await dbOrTx
    .insert(table)
    .values(rows)
    .onConflictDoUpdate({ target: options.target, set: options.set })
    .returning()) as T['$inferSelect'][];
}

/**
 * Reads everything a page at a time (default 1000 rows), so exports and syncs never stop at a page cap.
 * `fetchPage` must order by a unique key.
 * ponytail: offset paging; switch the caller to keyset paging if a table grows past ~100k rows.
 */
export async function* pageAll<T>(fetchPage: (limit: number, offset: number) => Promise<T[]>, pageSize = 1000): AsyncGenerator<T[]> {
  for (let offset = 0; ; offset += pageSize) {
    const page = await fetchPage(pageSize, offset);
    if (page.length) yield page;
    if (page.length < pageSize) return;
  }
}
