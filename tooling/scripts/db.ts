// Throwaway Postgres databases cloned from one template. Used by `pnpm db:fresh <name>` and by
// `@ecomkit/core/testing` createTestDb. Only databases named `ecomkit_*` are ever dropped.
import pg from 'pg';

export const TEMPLATE_DB = 'ecomkit_template';
const MIN_SERVER_VERSION = 170000;
/** Extensions every database gets from the template. */
const TEMPLATE_EXTENSIONS = ['pg_trgm'];
/** Tried in order when DATABASE_ADMIN_URL is unset; the first Postgres 17+ server wins. */
const CANDIDATE_ADMIN_URLS = ['postgres://localhost:5432/postgres', 'postgres://localhost:5433/postgres'];

export function databaseName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!slug) throw new Error(`invalid database name "${name}"`);
  const db = slug.startsWith('ecomkit_') ? slug : `ecomkit_${slug}`;
  if (db === TEMPLATE_DB || db.length > 63) throw new Error(`refusing database name "${db}"`);
  return db;
}

async function connect(url: string): Promise<{ client: pg.Client; version: number }> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 });
  await client.connect();
  const { rows } = await client.query<{ v: string }>("select current_setting('server_version_num') as v");
  return { client, version: Number(rows[0]?.v) };
}

/** Admin connection to a Postgres 17+ server. Fails loudly instead of silently using an older server. */
export async function adminClient(): Promise<{ client: pg.Client; url: string }> {
  const urls = process.env.DATABASE_ADMIN_URL ? [process.env.DATABASE_ADMIN_URL] : CANDIDATE_ADMIN_URLS;
  const seen: string[] = [];
  for (const url of urls) {
    try {
      const { client, version } = await connect(url);
      if (version >= MIN_SERVER_VERSION) return { client, url };
      seen.push(`${url} is version ${version}`);
      await client.end();
    } catch (err) {
      seen.push(`${url}: ${(err as Error).message}`);
    }
  }
  throw new Error(`no Postgres 17+ server found (${seen.join('; ')}). Set DATABASE_ADMIN_URL.`);
}

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

async function ensureTemplate(client: pg.Client, adminUrl: string, refresh: boolean): Promise<void> {
  const exists = (await client.query('select 1 from pg_database where datname = $1', [TEMPLATE_DB])).rowCount === 1;
  if (exists && !refresh) return;
  if (exists) {
    await client.query(`alter database ${ident(TEMPLATE_DB)} is_template false`);
    await client.query(`drop database ${ident(TEMPLATE_DB)} with (force)`);
  }
  try {
    await client.query(`create database ${ident(TEMPLATE_DB)}`);
  } catch (err) {
    // ponytail: two agents creating the template at once; the loser reuses it. Run once with --refresh-template if it is half-built.
    if ((err as { code?: string }).code === '42P04') return;
    throw err;
  }
  const url = new URL(adminUrl);
  url.pathname = `/${TEMPLATE_DB}`;
  const { client: tpl } = await connect(url.toString());
  try {
    for (const ext of TEMPLATE_EXTENSIONS) await tpl.query(`create extension if not exists ${ident(ext)}`);
  } finally {
    await tpl.end();
  }
  await client.query(`alter database ${ident(TEMPLATE_DB)} is_template true`);
}

/** Drops and recreates `ecomkit_<name>` from the template. Returns its connection URL. */
export async function freshDatabase(name: string, options: { refreshTemplate?: boolean } = {}): Promise<string> {
  const db = databaseName(name);
  const { client, url } = await adminClient();
  try {
    await ensureTemplate(client, url, options.refreshTemplate ?? false);
    await client.query(`drop database if exists ${ident(db)} with (force)`);
    await client.query(`create database ${ident(db)} template ${ident(TEMPLATE_DB)}`);
  } finally {
    await client.end();
  }
  const target = new URL(url);
  target.pathname = `/${db}`;
  return target.toString();
}

export async function dropDatabase(name: string): Promise<void> {
  const db = databaseName(name);
  const { client } = await adminClient();
  try {
    await client.query(`drop database if exists ${ident(db)} with (force)`);
  } finally {
    await client.end();
  }
}
