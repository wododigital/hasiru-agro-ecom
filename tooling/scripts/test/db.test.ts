import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { databaseName, freshDatabase } from '../db';

describe('databaseName', () => {
  it('prefixes and sanitises, and refuses the template', () => {
    expect(databaseName('wp-00a')).toBe('ecomkit_wp_00a');
    expect(databaseName('ecomkit_shop')).toBe('ecomkit_shop');
    expect(() => databaseName('template')).toThrow(/refusing/);
    expect(() => databaseName('---')).toThrow(/invalid/);
  });
});

describe('freshDatabase', () => {
  it('creates a Postgres 17 database from the template with pg_trgm, twice in a row', async () => {
    await freshDatabase('wp-00a');
    const url = await freshDatabase('wp-00a');
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      const version = await client.query<{ v: string }>("select current_setting('server_version_num') as v");
      expect(Number(version.rows[0]!.v)).toBeGreaterThanOrEqual(170000);
      const ext = await client.query("select 1 from pg_extension where extname = 'pg_trgm'");
      expect(ext.rowCount).toBe(1);
      expect(new URL(url).pathname).toBe('/ecomkit_wp_00a');
    } finally {
      await client.end();
    }
    // CREATE DATABASE ... TEMPLATE waits for other sessions on the template; the full-workspace test run creates many.
  }, 60_000);
});
