import type { NotificationSender } from '@ecomkit/core/contracts';
import { enqueue, startWorker } from '@ecomkit/core/jobs';
import coreManifest, { createRegistry, defineModule } from '@ecomkit/core/manifest';
import type { TestDb } from '@ecomkit/core/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import inventoryManifest from '../src/manifest';
import { inventoryReservation } from '../src/schema';
import { getStock, reserve, setFromErp, setNotificationsProvider, subscribe } from '../src/server';
import { inventoryDb, makeLevel } from './helpers';

// The real worker with this module's manifest: the scheduled TTL sweep job and the stock.changed subscriber.
// Catalog is a hard dependency without anything this test needs, so a bare manifest stands in for it.
const catalogStandIn = defineModule({ id: 'catalog', dependsOn: ['core'] });

let t: TestDb;
let worker: { stop(): Promise<void> } | undefined;
const sent: string[] = [];

async function waitFor(check: () => Promise<boolean>, ms = 20_000): Promise<void> {
  const until = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > until) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 150));
  }
}

beforeAll(async () => {
  t = await inventoryDb('worker');
  const sender: NotificationSender = {
    async send(_key, to) {
      sent.push(to.email ?? to.phone ?? '');
      return { messageIds: [] };
    },
  };
  setNotificationsProvider(async () => sender);
  worker = await startWorker(createRegistry([coreManifest, catalogStandIn, inventoryManifest], { mocks: true }), { name: 'inventory-test', pollingIntervalSeconds: 0.5 });
});

afterAll(async () => {
  await worker?.stop();
  await t?.close();
});

describe('worker', () => {
  it('registers the TTL sweep every minute', async () => {
    const { rows } = await t.pool.query<{ name: string; cron: string; timezone: string }>("select name, cron, timezone from pgboss.schedule where name = 'inventory.release-expired'");
    expect(rows).toEqual([{ name: 'inventory.release-expired', cron: '* * * * *', timezone: 'Asia/Kolkata' }]);
  });

  it('the release-expired job releases a hold past its TTL (the job runs on the real clock)', async () => {
    const v = await makeLevel(4);
    const r = await reserve([{ variantId: v.variantId, qty: 4 }], { ttlSec: 60, reference: 'expired-attempt', now: new Date(Date.now() - 120_000) });
    if (!r.ok) throw new Error('expected a reservation');
    expect((await getStock(v.variantId))?.available).toBe(0);
    await enqueue('inventory.release-expired');
    await waitFor(async () => (await t.db.select().from(inventoryReservation).where(eq(inventoryReservation.id, r.reservation.reservationId)))[0]?.status === 'released');
    expect((await getStock(v.variantId))?.available).toBe(4);
  });

  it('stock coming back routes stock.changed to the subscriber, which sends back-in-stock messages', async () => {
    const v = await makeLevel(0);
    await subscribe({ variantId: v.variantId, email: 'worker@example.com', consent: true });
    await setFromErp([{ variantId: v.variantId, onHand: 3 }]);
    await waitFor(async () => sent.includes('worker@example.com'));
  });
});
