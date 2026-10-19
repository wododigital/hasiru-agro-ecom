import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createTestDb, type TestDb } from '@ecomkit/core/testing';

export const PARTITIONS_SQL = readFileSync(new URL('../sql/partitions.sql', import.meta.url), 'utf8');

/** Throwaway ecomkit_<name> with the core + analytics schemas pushed and analytics_event converted to partitions. */
export async function analyticsDb(name: string): Promise<TestDb> {
  process.env.INTERNAL_SECRET ??= 'analytics-test-secret-'.padEnd(40, 'x');
  const t = await createTestDb(name, { schemas: ['core', 'analytics'] });
  await t.pool.query(PARTITIONS_SQL);
  return t;
}

export const CHROME_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
export const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
export const BOT_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

export function ev(n: string, p = '/', d?: Record<string, string | number | boolean | null>, at = Date.now()) {
  return { i: randomUUID(), n, p, t: at, ...(d ? { d } : {}) };
}

export const minutes = (m: number) => m * 60_000;
