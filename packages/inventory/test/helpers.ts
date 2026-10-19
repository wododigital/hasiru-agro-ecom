import { randomBytes } from 'node:crypto';
import { newId } from '@ecomkit/core/ids';
import { createTestDb, queuedJobs, type TestDb } from '@ecomkit/core/testing';
import { sql } from 'drizzle-orm';
import { seedLevels } from '../src/server';

/** Own database per test file (vitest runs files in parallel): ecomkit_wp_07_<suffix>. */
export async function inventoryDb(suffix: string): Promise<TestDb> {
  process.env.INTERNAL_SECRET ??= 'i'.repeat(40);
  process.env.SETTINGS_MASTER_KEY ??= `1:${randomBytes(32).toString('base64')}`;
  return createTestDb(`wp-07-${suffix}`, { schemas: ['core', 'inventory'] });
}

export async function makeLevel(onHand: number, extra: { readyInDays?: number | null; lowStockThreshold?: number | null; sku?: string } = {}) {
  const variantId = newId();
  const productId = newId();
  await seedLevels([{ variantId, productId, onHand, sku: extra.sku ?? `T-${variantId.slice(-6)}`, readyInDays: extra.readyInDays ?? null, lowStockThreshold: extra.lowStockThreshold ?? null }]);
  return { variantId, productId };
}

/** Catalogue events written to the outbox (core.event jobs), optionally for one event name. */
export async function outboxEvents(t: TestDb, event?: string): Promise<{ event: string; payload: Record<string, unknown> }[]> {
  const jobs = await queuedJobs(t.db, 'core.event');
  return jobs
    .map((j) => j.data as { event: string; payload: Record<string, unknown> })
    .map(({ event: name, payload }) => ({ event: name, payload }))
    .filter((e) => !event || e.event === event);
}

/** Every variant whose on_hand differs from the sum of its ledger rows (should always be empty). */
export async function ledgerMismatches(t: TestDb) {
  const { rows } = await t.db.execute<{ variant_id: string; on_hand: number; ledger: number }>(sql`
    select l.variant_id, l.on_hand, coalesce(sum(m.delta), 0)::int as ledger
    from inventory_level l left join inventory_movement m on m.variant_id = l.variant_id
    group by l.variant_id, l.on_hand
    having l.on_hand <> coalesce(sum(m.delta), 0)`);
  return rows;
}
