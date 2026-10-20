// The module as the app runs it: manifests in a registry and a real pg-boss worker routing catalogue events to the
// flows subscribers and running the `flows.run-due` job. Channels are off, so deliveries end as skipped.
import { emit } from '@ecomkit/core/events';
import { newId } from '@ecomkit/core/ids';
import { enqueue, startWorker } from '@ecomkit/core/jobs';
import coreManifest, { createRegistry, defineModule } from '@ecomkit/core/manifest';
import { setSettings } from '@ecomkit/core/settings';
import { createTestDb, type TestDb } from '@ecomkit/core/testing';
import customers from '@ecomkit/customers/manifest';
import { recordConsent } from '@ecomkit/customers/server';
import notifications from '@ecomkit/notifications/manifest';
import { notificationsMessage } from '@ecomkit/notifications/schema';
import { settingsDef } from '@ecomkit/notifications/server';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import manifest from '../src/manifest';
import { FLOW_DEFS } from '../src/domain';
import { flowsRun } from '../src/schema';
import { saveFlow } from '../src/server/flows';
import { startFlow } from '../src/server/runner';
import { bindFakes, cart, order, testEnv, type Fakes } from './harness';

let t: TestDb;
let f: Fakes;
let worker: { stop(): Promise<void> } | undefined;
const auth = defineModule({ id: 'auth', dependsOn: ['core'] });
const registry = createRegistry([coreManifest, auth, notifications, customers, manifest], { mocks: false });

beforeAll(async () => {
  testEnv();
  t = await createTestDb('wp-22-worker', { schemas: ['core', 'notifications', 'customers', 'flows'] });
  await setSettings(settingsDef, { whatsappMode: 'off', emailMode: 'off' }, { actorId: null });
  f = bindFakes();
  worker = await startWorker(registry, { pollingIntervalSeconds: 0.5 });
}, 120_000);

afterAll(async () => {
  await worker?.stop();
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

it('cart.abandoned reaches the subscriber and starts a run; order.confirmed sends at once', async () => {
  const phone = '+919811100001';
  await recordConsent({ subject: { phone }, purpose: 'marketing', granted: true, textShown: 'Send me cart reminders.', source: 'checkout' });
  const cartId = newId();
  f.carts.set(cartId, cart({ phone }));
  await emit('cart.abandoned', { cartId, checkoutSessionId: null });
  const runs = await waitFor(
    () => t.db.select().from(flowsRun).where(eq(flowsRun.subjectId, cartId)),
    (r) => r.length > 0,
  );
  expect(runs[0]).toMatchObject({ status: 'running', messages: 0 });

  const orderId = newId();
  f.orders.set(orderId, order({ phone: '+919811100002' }));
  await emit('order.confirmed', { orderId, orderNumber: 'A-1' });
  const msgs = await waitFor(
    () => t.db.select().from(notificationsMessage).where(eq(notificationsMessage.orderId, orderId)),
    (m) => m.length > 0,
  );
  expect(msgs.map((m) => m.templateKey)).toEqual(['order.confirmed']);
}, 40_000);

it('the flows.run-due job advances a run whose step is due', async () => {
  const phone = '+919811100003';
  await recordConsent({ subject: { phone }, purpose: 'marketing', granted: true, textShown: 'Send me cart reminders.', source: 'checkout' });
  const cartId = newId();
  f.carts.set(cartId, cart({ phone }));
  // No quiet hours here (the wall clock decides), so the 1 h reminder of a cart abandoned 3 h ago is due.
  await saveFlow('abandoned_cart', { status: 'active', settings: { ...FLOW_DEFS.abandoned_cart.defaults, quietHours: [] } }, null);
  const started = await startFlow('abandoned_cart', { type: 'cart', id: cartId }, { cartId }, { now: new Date(Date.now() - 3 * 3_600_000) });
  const runId = started!.run.id;
  await enqueue('flows.run-due');
  const run = await waitFor(
    async () => (await t.db.select().from(flowsRun).where(eq(flowsRun.id, runId)))[0]!,
    (r) => r.messages > 0,
  );
  // Phone only: the WhatsApp reminder goes, the email row is skipped (no address).
  expect(run.messages).toBe(1);
}, 40_000);
