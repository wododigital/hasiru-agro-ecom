import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createTestDb, queuedJobs, type TestDb } from '@ecomkit/core/testing';
import { shippingSeedSchema, type ShippingSeed } from '../src/domain';
import { loadShippingSeed } from '../src/server';

export const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url));

/** Own database per test file (vitest runs files in parallel): ecomkit_wp_18_<suffix>. */
export async function shippingDb(suffix: string): Promise<TestDb> {
  process.env.INTERNAL_SECRET ??= 'i'.repeat(40);
  process.env.SETTINGS_MASTER_KEY ??= `1:${randomBytes(32).toString('base64')}`;
  return createTestDb(`wp-18-${suffix}`, { schemas: ['core', 'shipping'] });
}

export async function fixtureSeed(): Promise<ShippingSeed> {
  return shippingSeedSchema.parse(JSON.parse(await readFile(`${FIXTURE_DIR}shipping.json`, 'utf8')));
}

export async function seedFixture(): Promise<void> {
  await loadShippingSeed(await fixtureSeed());
}

export async function outboxEvents(t: TestDb, event: string): Promise<Record<string, unknown>[]> {
  const jobs = await queuedJobs(t.db, 'core.event');
  return jobs.map((j) => j.data as { event: string; payload: Record<string, unknown> }).filter((e) => e.event === event).map((e) => e.payload);
}
