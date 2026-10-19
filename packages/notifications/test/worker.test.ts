// The module as the app runs it: manifest in a registry, a real pg-boss worker delivering queued messages
// and processing the webhooks the mock sends back, the `notifications` service resolved through the registry.
import coreManifest, { createRegistry } from '@ecomkit/core/manifest';
import { startWorker } from '@ecomkit/core/jobs';
import { createTestDb, type TestDb } from '@ecomkit/core/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import manifest from '../src/manifest';
import { metaMockState } from '../src/mocks/meta';
import { updateSettings } from '../src/server/config';
import { notificationsMessage } from '../src/schema';
import { startHarness, testEnv } from './harness';

let t: TestDb;
let harness: Awaited<ReturnType<typeof startHarness>>;
let worker: { stop(): Promise<void> } | undefined;
const registry = createRegistry([coreManifest, manifest], { mocks: true });

beforeAll(async () => {
  testEnv();
  harness = await startHarness();
  t = await createTestDb('wp-10-worker', { schemas: ['core', 'notifications'] });
  await updateSettings({ storeName: 'Acme Store' }, { actorId: null });
  metaMockState().statusDelayMs = 50;
  worker = await startWorker(registry, { pollingIntervalSeconds: 0.5 });
}, 90_000);

afterAll(async () => {
  await worker?.stop();
  await harness?.close();
  await t?.close();
});

async function waitFor<T>(read: () => Promise<T>, ok: (v: T) => boolean, ms = 20_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (ok(v) || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
}

it('registry service queues, the worker delivers, and the status webhook lands as read', async () => {
  const sender = await registry.service('notifications');
  expect(sender).not.toBeNull();
  const { messageIds } = await sender!.send('order.packed', { phone: '+919876543210' }, { name: 'Asha', order_number: 'A-1' });
  const row = await waitFor(
    async () => (await t.db.select().from(notificationsMessage).where(eq(notificationsMessage.id, messageIds[0]!)))[0]!,
    (r) => r.status === 'read',
  );
  expect(row.status).toBe('read');
  expect(row.providerMessageId).toMatch(/^wamid\.mock\./);
}, 30_000);
