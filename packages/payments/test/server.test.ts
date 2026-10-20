// Real Postgres + real HTTP: payments runs in mock mode against the mock gateway served by a local HTTP server;
// the mock pay page posts authenticated webhooks to the real webhook handler, which stores them and queues the job.
import { createHash } from 'node:crypto';
import { setSettings } from '@ecomkit/core/settings';
import { createTestDb, queuedJobs, type TestDb } from '@ecomkit/core/testing';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { flushPhonepeMock, phonepeMockState, resetPhonepeMock } from '../src/mocks/phonepe';
import { anomalyHealth, attemptsForOrder, gatewayHealth, listAttempts, listOpenBankTransfers, listRefunds, testConnectionAction } from '../src/server/actions';
import { settingsDef, webhookCredentials } from '../src/server/config';
import { pollPending, sweep } from '../src/server/jobs';
import {
  capturedOf,
  createPayment,
  markBankTransferReceived,
  paymentOptions,
  refund,
  startRefundTask,
  type CreatePaymentOutcome,
} from '../src/server/payments';
import { clearTokenCache } from '../src/server/phonepe';
import { returnView } from '../src/server/return';
import { processWebhookEvent } from '../src/server/webhook';
import { paymentsAttempt, paymentsRefund, paymentsWebhookEvent } from '../src/schema';
import { paymentsSettingsSchema } from '../src/settings';
import { bindPorts, createQueues, STAFF_ID, startHarness, testEnv, type FakeOrders } from './harness';
import type { PaymentsAlert } from '../src/server/ports';

let t: TestDb;
let harness: Awaited<ReturnType<typeof startHarness>>;
let orders: FakeOrders;
let alerts: PaymentsAlert[];
const MIN = 60_000;

type Ok = Extract<CreatePaymentOutcome, { ok: true }>;
async function start(total: number, method: 'online' | 'cod_partial' | 'bank_transfer' = 'online') {
  const order = orders.add(total);
  const r = await createPayment({ orderId: order.id, method });
  expect(r.ok).toBe(true);
  return { order, r: r as Ok };
}

/** Clicks a button on the mock pay page; returns where the buyer is sent back to. */
async function payPage(merchantOrderId: string, outcome: 'success' | 'fail' | 'pending' | 'abandon'): Promise<string | null> {
  const res = await fetch(`${harness.origin}/api/_mock/phonepe/paypage`, { method: 'POST', body: new URLSearchParams({ o: merchantOrderId, outcome }), redirect: 'manual' });
  expect(res.status).toBe(303);
  return res.headers.get('location');
}

/** What the worker does: run every queued webhook job (processing is idempotent). */
async function runWebhookJobs(): Promise<number> {
  await flushPhonepeMock();
  const jobs = await queuedJobs(t.db, 'payments.process-webhook');
  for (const j of jobs) await processWebhookEvent((j.data as { eventId: string }).eventId);
  return jobs.length;
}

const attempt = async (id: string) => (await t.db.select().from(paymentsAttempt).where(eq(paymentsAttempt.id, id)))[0]!;
const refundsOf = async (attemptId: string) => t.db.select().from(paymentsRefund).where(eq(paymentsRefund.attemptId, attemptId));

async function postWebhook(body: string, authorization: string | null): Promise<number> {
  const res = await fetch(`${harness.origin}/api/webhooks/phonepe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(authorization === null ? {} : { authorization }) },
    body,
  });
  return res.status;
}
async function validAuth(encoding: 'hex' | 'base64' = 'hex'): Promise<string> {
  const c = webhookCredentials(paymentsSettingsSchema.parse({}), 'mock')!;
  return createHash('sha256').update(`${c.username}:${c.password}`).digest(encoding);
}

beforeAll(async () => {
  testEnv();
  harness = await startHarness();
  // CREATE DATABASE from the template waits on other packages' sessions during the parallel workspace run.
  t = await createTestDb('wp-20-server', { schemas: ['core', 'payments'] });
  await createQueues();
}, 120_000);

afterAll(async () => {
  await harness?.close();
  await t?.close();
});

beforeEach(async () => {
  resetPhonepeMock();
  clearTokenCache();
  ({ orders, alerts } = bindPorts());
  await t.db.execute(sql`truncate payments_refund, payments_attempt, payments_webhook_event, core_rate_limit`);
  await t.db.execute(sql`delete from pgboss.job where name = 'payments.process-webhook'`);
  await setSettings(settingsDef, { mode: 'mock', codMode: 'online_only', bankTransfer: false, payAtPickup: false, attemptExpiryMinutes: 15 }, { actorId: null });
});

describe('online payment', () => {
  it('pay page success -> stored webhook -> status check -> order paid once', async () => {
    const before = Date.now();
    const { order, r } = await start(250000);
    expect(r.merchantOrderId).toBe(`${order.number}-1`);
    expect(r.redirectUrl).toBe(`${harness.origin}/api/_mock/phonepe/paypage?o=${encodeURIComponent(r.merchantOrderId)}`);
    expect(r.expiresAt.getTime() - before).toBeGreaterThanOrEqual(15 * MIN - 1000);
    expect(r.expiresAt.getTime() - before).toBeLessThanOrEqual(15 * MIN + 5000);

    expect(await payPage(r.merchantOrderId, 'success')).toBe(`${harness.origin}/pay/return?a=${r.attemptId}`);
    // The webhook alone never pays: stored and queued, attempt still pending.
    const events = await t.db.select().from(paymentsWebhookEvent);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ signatureOk: true, event: 'checkout.order.completed', processedAt: null });
    expect((await attempt(r.attemptId)).state).toBe('pending');
    expect(orders.paid).toHaveLength(0);

    expect(await runWebhookJobs()).toBe(1);
    const a = await attempt(r.attemptId);
    expect(a.state).toBe('completed');
    expect(a.appliedAt).not.toBeNull();
    expect(orders.paid).toEqual([{ orderId: order.id, amountPaise: 250000, attemptId: r.attemptId, method: 'online' }]);
    expect(await returnView(r.attemptId)).toMatchObject({ state: 'paid', orderLink: `/order/guest-${order.id}`, retryLink: null });
  });

  it('a replayed webhook is stored and processed once', async () => {
    phonepeMockState().duplicateWebhooks = true;
    const { r } = await start(10000);
    await payPage(r.merchantOrderId, 'success');
    await flushPhonepeMock();
    expect(phonepeMockState().webhooks.map((w) => w.status)).toEqual([200, 200]);
    // Same body again by hand.
    const body = JSON.stringify({ event: 'checkout.order.completed', payload: { merchantOrderId: r.merchantOrderId, state: 'COMPLETED', amount: 10000 } });
    expect(await postWebhook(body, await validAuth())).toBe(200);
    expect(await t.db.select().from(paymentsWebhookEvent)).toHaveLength(1);
    expect(await runWebhookJobs()).toBe(1);
    await runWebhookJobs();
    expect(orders.paid).toHaveLength(1);
  });

  it('open attempt is reused; after a failure the retry is attempt 2 inside the same window', async () => {
    const { order, r } = await start(50000);
    const again = await createPayment({ orderId: order.id });
    expect(again).toMatchObject({ ok: true, attemptId: r.attemptId, reused: true, redirectUrl: r.redirectUrl });
    expect(await createPayment({ orderId: order.id, method: 'bank_transfer' })).toEqual({ ok: false, reason: 'method_unavailable' });

    await payPage(r.merchantOrderId, 'fail');
    await runWebhookJobs();
    expect((await attempt(r.attemptId)).state).toBe('failed');
    expect(orders.orders.get(order.id)!.status).toBe('pending_payment');
    expect(orders.paid).toHaveLength(0);
    expect(await returnView(r.attemptId)).toMatchObject({ state: 'failed', retryLink: `/checkout/${order.id}/pay` });

    const retry = (await createPayment({ orderId: order.id })) as Ok;
    expect(retry.ok).toBe(true);
    expect(retry.merchantOrderId).toBe(`${order.number}-2`);
    expect(retry.expiresAt.getTime()).toBe(r.expiresAt.getTime());
    expect(await createPayment({ orderId: order.id }, { now: new Date(r.expiresAt.getTime() - 4 * MIN) })).toMatchObject({ ok: true, reused: true });
  });

  it('the return page asks the status API itself (no webhook needed); pending stays pending', async () => {
    const { r } = await start(30000);
    expect(await returnView(r.attemptId)).toMatchObject({ state: 'pending' });
    phonepeMockState().orders.get(r.merchantOrderId)!.state = 'COMPLETED'; // captured, webhook not sent
    expect(await returnView(r.attemptId)).toMatchObject({ state: 'paid' });
    expect(orders.paid).toHaveLength(1);
    expect(await returnView('not-a-uuid')).toBeNull();
    expect(await returnView('0192a000-0000-7000-8000-00000000ffff')).toBeNull();
  });

  it('refuses unknown orders, orders not awaiting payment and switched-off methods', async () => {
    expect(await createPayment({ orderId: '0192a000-0000-7000-8000-00000000abcd' })).toEqual({ ok: false, reason: 'not_found' });
    const paid = orders.add(1000, { status: 'paid' });
    expect(await createPayment({ orderId: paid.id })).toEqual({ ok: false, reason: 'not_payable' });
    const o = orders.add(1000);
    expect(await createPayment({ orderId: o.id, method: 'cod_partial' })).toEqual({ ok: false, reason: 'method_unavailable' });
    const tiny = orders.add(50);
    expect(await createPayment({ orderId: tiny.id })).toEqual({ ok: false, reason: 'amount_too_small' });
  });
});

describe('webhook authentication', () => {
  const body = JSON.stringify({ event: 'checkout.order.completed', payload: { merchantOrderId: 'X-1', state: 'COMPLETED' } });

  it('accepts hex and base64 encodings', async () => {
    expect(await postWebhook(body, await validAuth('hex'))).toBe(200);
    phonepeMockState().hashEncoding = 'base64';
    const { r } = await start(10000);
    await payPage(r.merchantOrderId, 'success');
    await flushPhonepeMock();
    expect(phonepeMockState().webhooks.at(-1)!.status).toBe(200);
  });

  it('wrong hash, wrong length and a missing header are 401, recorded, and the third raises the alert', async () => {
    const good = await validAuth();
    expect(await postWebhook(body, createHash('sha256').update('mock:wrong').digest('hex'))).toBe(401);
    expect(await postWebhook(body, good.slice(0, 40))).toBe(401);
    expect(alerts).toHaveLength(0);
    expect(await postWebhook(body, null)).toBe(401);
    const rows = await t.db.select().from(paymentsWebhookEvent);
    expect(rows.every((r) => !r.signatureOk && r.payload === null)).toBe(true);
    expect(rows).toHaveLength(3);
    expect(alerts.at(-1)).toMatchObject({ rule: 'payments.webhook_signature', severity: 'critical' });
    expect(await queuedJobs(t.db, 'payments.process-webhook')).toHaveLength(0);
  });

  it('sandbox or live without webhook credentials refuses every webhook', async () => {
    await setSettings(settingsDef, { mode: 'sandbox' }, { actorId: null });
    expect(await postWebhook(body, await validAuth())).toBe(401);
  });
});

describe('anomalies: alert + refund task, never a state flip', () => {
  it('amount mismatch', async () => {
    const { order, r } = await start(40000);
    phonepeMockState().orders.get(r.merchantOrderId)!.reportAmount = 39900;
    await payPage(r.merchantOrderId, 'success');
    await runWebhookJobs();
    const a = await attempt(r.attemptId);
    expect(a).toMatchObject({ state: 'completed', anomaly: 'amount_mismatch', appliedAt: null });
    expect(orders.paid).toHaveLength(0);
    expect(orders.orders.get(order.id)!.status).toBe('pending_payment');
    expect(await refundsOf(r.attemptId)).toMatchObject([{ state: 'task', amountPaise: 39900, reason: 'amount_mismatch', merchantRefundId: `${r.merchantOrderId}-R1` }]);
    expect(alerts).toMatchObject([{ rule: 'payments.amount_mismatch', severity: 'critical', fingerprint: r.merchantOrderId }]);
    expect(await returnView(r.attemptId)).toMatchObject({ state: 'review' });
  });

  it('late COMPLETED on a cancelled order creates a refund task and no state flip', async () => {
    const { order, r } = await start(20000);
    const late = new Date(r.expiresAt.getTime() + MIN);
    expect(await sweep({ now: late })).toMatchObject({ expired: 1, closedOrders: 1 });
    expect(orders.orders.get(order.id)!.status).toBe('cancelled');
    expect(orders.expired).toEqual([{ orderId: order.id, reason: 'expired' }]);

    await payPage(r.merchantOrderId, 'success');
    await runWebhookJobs();
    expect(orders.orders.get(order.id)!.status).toBe('cancelled');
    expect(orders.paid).toHaveLength(0);
    expect(await attempt(r.attemptId)).toMatchObject({ state: 'completed', anomaly: 'late_completed', appliedAt: null });
    expect(await refundsOf(r.attemptId)).toMatchObject([{ state: 'task', amountPaise: 20000, reason: 'late_completed' }]);
    expect(alerts).toMatchObject([{ rule: 'payments.late_completed', severity: 'critical' }]);
    // A replay of the same capture adds nothing.
    phonepeMockState().orders.get(r.merchantOrderId)!.state = 'COMPLETED';
    await returnView(r.attemptId);
    expect(await refundsOf(r.attemptId)).toHaveLength(1);
    expect(alerts).toHaveLength(1);
    expect(await anomalyHealth()).toMatchObject({ status: 'degraded' });
  });

  it('the orders side refusing the payment under its lock becomes a late capture', async () => {
    const { r } = await start(18000);
    orders.refuseNextPayment = true;
    await payPage(r.merchantOrderId, 'success');
    await runWebhookJobs();
    expect(await attempt(r.attemptId)).toMatchObject({ state: 'completed', anomaly: 'late_completed', appliedAt: null, sweptAt: null });
    expect(await refundsOf(r.attemptId)).toMatchObject([{ state: 'task', reason: 'late_completed' }]);
    expect(alerts).toMatchObject([{ rule: 'payments.late_completed' }]);
  });

  it('COMPLETED after FAILED', async () => {
    const { order, r } = await start(15000);
    await payPage(r.merchantOrderId, 'fail');
    await runWebhookJobs();
    expect((await attempt(r.attemptId)).state).toBe('failed');
    await payPage(r.merchantOrderId, 'success'); // the gateway changes its mind
    await runWebhookJobs();
    expect(await attempt(r.attemptId)).toMatchObject({ state: 'completed', anomaly: 'late_completed', appliedAt: null });
    expect(orders.paid).toHaveLength(0);
    expect(orders.orders.get(order.id)!.status).toBe('pending_payment');
    expect(await refundsOf(r.attemptId)).toHaveLength(1);
  });

  it('a refund task is started by staff and settles without touching the order', async () => {
    const { r } = await start(20000);
    await sweep({ now: new Date(r.expiresAt.getTime() + MIN) });
    await payPage(r.merchantOrderId, 'success');
    await runWebhookJobs();
    const [task] = await refundsOf(r.attemptId);
    const res = await startRefundTask({ refundId: task!.id, actorId: STAFF_ID });
    expect(res.ok).toBe(true);
    expect(await startRefundTask({ refundId: task!.id, actorId: STAFF_ID })).toEqual({ ok: false, reason: 'not_refundable' });
    await runWebhookJobs(); // pg.refund.completed
    expect((await refundsOf(r.attemptId))[0]!.state).toBe('completed');
    expect(orders.refunded).toHaveLength(0);
  });
});

describe('sweep and poll', () => {
  it('expired pending attempt: last status check, expired, orders hook once', async () => {
    const { order, r } = await start(12000);
    expect(await sweep({ now: new Date(r.expiresAt.getTime() - MIN) })).toMatchObject({ expired: 0, closedOrders: 0 });
    const statusCalls = phonepeMockState().statusCalls;
    const late = new Date(r.expiresAt.getTime() + MIN);
    expect(await sweep({ now: late })).toMatchObject({ expired: 1, closedOrders: 1 });
    expect(phonepeMockState().statusCalls).toBe(statusCalls + 1);
    expect((await attempt(r.attemptId)).state).toBe('expired');
    expect(await sweep({ now: late })).toMatchObject({ expired: 0, closedOrders: 0 });
    expect(orders.expired).toEqual([{ orderId: order.id, reason: 'expired' }]);
  });

  it('a capture found by the last check is applied, not expired', async () => {
    const { order, r } = await start(12000);
    phonepeMockState().orders.get(r.merchantOrderId)!.state = 'COMPLETED';
    expect(await sweep({ now: new Date(r.expiresAt.getTime() + MIN) })).toMatchObject({ expired: 0, closedOrders: 0 });
    expect(orders.orders.get(order.id)!.status).toBe('paid');
  });

  it('a failed attempt closes the order with reason failed once the window is over', async () => {
    const { order, r } = await start(12000);
    await payPage(r.merchantOrderId, 'fail');
    await runWebhookJobs();
    expect(await sweep({ now: new Date(r.expiresAt.getTime() - MIN) })).toMatchObject({ closedOrders: 0 });
    expect(await sweep({ now: new Date(r.expiresAt.getTime() + 1000) })).toMatchObject({ closedOrders: 1 });
    expect(orders.expired).toEqual([{ orderId: order.id, reason: 'failed' }]);
  });

  it('poll checks due attempts; a 429 pushes them back with back-off', async () => {
    const { r } = await start(12000);
    const soon = new Date(Date.now() + 25_000);
    phonepeMockState().orders.get(r.merchantOrderId)!.state = 'COMPLETED';
    const second = await start(13000);
    phonepeMockState().rateLimitNext = 100;
    expect(await pollPending({ now: soon })).toEqual({ checked: 0, rateLimited: true });
    const pushed = await attempt(r.attemptId);
    expect(pushed.state).toBe('pending');
    expect(pushed.nextPollAt!.getTime()).toBeGreaterThanOrEqual(soon.getTime() + 30_000);
    expect((await attempt(second.r.attemptId)).nextPollAt!.getTime()).toBe(pushed.nextPollAt!.getTime());

    phonepeMockState().rateLimitNext = 0;
    const later = new Date(soon.getTime() + 10 * MIN);
    expect(await pollPending({ now: later })).toEqual({ checked: 2, rateLimited: false });
    expect((await attempt(r.attemptId)).state).toBe('completed');
    const still = await attempt(second.r.attemptId);
    expect(still.state).toBe('pending');
    expect(still.pollCount).toBe(1);
    expect(still.nextPollAt!.getTime()).toBe(later.getTime() + 60_000);
  });
});

describe('refunds', () => {
  it('partial refunds settle through the webhook and update the order; more than captured is refused', async () => {
    const { order, r } = await start(30000);
    await payPage(r.merchantOrderId, 'success');
    await runWebhookJobs();
    const first = await refund({ orderId: order.id, amountPaise: 10000, reason: 'One plant damaged', actorId: STAFF_ID });
    expect(first).toMatchObject({ ok: true, refund: { merchantRefundId: `${r.merchantOrderId}-R1` } });
    await runWebhookJobs();
    expect(orders.refunded).toEqual([{ orderId: order.id, refundId: first.ok ? first.refund.id : '', amountPaise: 10000 }]);
    expect(await refund({ orderId: order.id, amountPaise: 20001, reason: 'too much', actorId: STAFF_ID })).toEqual({ ok: false, reason: 'exceeds_captured' });
    phonepeMockState().refundAutoComplete = false;
    const second = await refund({ orderId: order.id, amountPaise: 20000, reason: 'Rest', actorId: STAFF_ID });
    expect(second).toMatchObject({ ok: true, refund: { state: 'pending' } });
    // Settled later through the poll (no webhook).
    phonepeMockState().refunds.get(`${r.merchantOrderId}-R2`)!.state = 'COMPLETED';
    await pollPending({ now: new Date(Date.now() + 2 * MIN) });
    expect(orders.refunded).toHaveLength(2);
    expect(await refund({ orderId: orders.add(1000).id, amountPaise: 100, reason: 'x', actorId: STAFF_ID })).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('offline and partial methods', () => {
  it('bank transfer: offline attempt with its own hold, staff mark received; a wrong amount is a mismatch', async () => {
    await setSettings(settingsDef, { bankTransfer: true, bankTransferHours: 48, bankTransferNote: 'Account 123, IFSC TEST0001' }, { actorId: null });
    const { order, r } = await start(60000, 'bank_transfer');
    expect(r).toMatchObject({ redirectUrl: null, state: 'pending', instructions: 'Account 123, IFSC TEST0001' });
    expect(r.expiresAt.getTime() - Date.now()).toBeGreaterThan(47 * 60 * MIN);
    expect(await pollPending({ now: new Date(Date.now() + 10 * MIN) })).toMatchObject({ checked: 0 });
    expect(await markBankTransferReceived({ attemptId: r.attemptId, amountPaise: 60000, actorId: STAFF_ID })).toMatchObject({ ok: true, anomaly: null });
    expect(orders.paid).toEqual([{ orderId: order.id, amountPaise: 60000, attemptId: r.attemptId, method: 'bank_transfer' }]);
    // Re-marking a completed transfer cannot inflate the captured amount that caps refunds.
    expect(await markBankTransferReceived({ attemptId: r.attemptId, amountPaise: 9_000_000, actorId: STAFF_ID })).toEqual({ ok: false, reason: 'not_pending' });
    const [done] = await t.db.select().from(paymentsAttempt).where(eq(paymentsAttempt.id, r.attemptId));
    expect(capturedOf(done!)).toBe(60000);

    const other = await start(5000, 'bank_transfer');
    expect(await markBankTransferReceived({ attemptId: other.r.attemptId, amountPaise: 4000, actorId: STAFF_ID })).toMatchObject({ ok: true, anomaly: 'amount_mismatch' });
    expect(orders.paid).toHaveLength(1);
    const audit = await t.db.execute<{ action: string }>(sql`select action from core_audit_log where entity = 'payments_attempt'`);
    expect(audit.rows.map((x) => x.action)).toEqual(['payment.mark_received', 'payment.mark_received']);
  });

  it('partial advance pays the advance online and marks the order with that amount', async () => {
    await setSettings(settingsDef, { codMode: 'partial_advance', advancePercent: 30 }, { actorId: null });
    const { order, r } = await start(250000, 'cod_partial');
    expect(r.amountPaise).toBe(75000);
    await payPage(r.merchantOrderId, 'success');
    await runWebhookJobs();
    expect(orders.paid).toEqual([{ orderId: order.id, amountPaise: 75000, attemptId: r.attemptId, method: 'cod_partial' }]);
  });

  it('payment options follow settings and carry the stock hold', async () => {
    expect(await paymentOptions({ totalPaise: 250000 })).toEqual([{ id: 'online', payNowPaise: 250000, windowSec: 900 }]);
    await setSettings(settingsDef, { codMode: 'partial_advance', bankTransfer: true, payAtPickup: true }, { actorId: null });
    expect((await paymentOptions({ totalPaise: 250000, pickup: true })).map((o) => [o.id, o.payNowPaise, o.windowSec])).toEqual([
      ['online', 250000, 900],
      ['cod_partial', 75000, 900],
      ['bank_transfer', 0, 48 * 3600],
      ['pay_at_pickup', 0, 900],
    ]);
    expect((await paymentOptions({ totalPaise: 250000, pickup: false })).map((o) => o.id)).not.toContain('pay_at_pickup');
  });
});

describe('admin lists', () => {
  it('attempts filter by state, gateway and reference; refund tasks come first; open bank transfers', async () => {
    await setSettings(settingsDef, { bankTransfer: true }, { actorId: null });
    const paid = await start(30000);
    await payPage(paid.r.merchantOrderId, 'success');
    await runWebhookJobs();
    await refund({ orderId: paid.order.id, amountPaise: 1000, reason: 'damaged', actorId: STAFF_ID });
    const late = await start(20000);
    await sweep({ now: new Date(late.r.expiresAt.getTime() + MIN) });
    await payPage(late.r.merchantOrderId, 'success');
    await runWebhookJobs();
    const bank = await start(5000, 'bank_transfer');

    const page = { q: '', page: 1, pageSize: 50 };
    expect((await listAttempts(page)).total).toBe(3);
    expect((await listAttempts({ ...page, state: 'pending' })).rows.map((r) => r.id)).toEqual([bank.r.attemptId]);
    expect((await listAttempts({ ...page, provider: 'mock' })).total).toBe(2);
    expect((await listAttempts({ ...page, q: late.r.merchantOrderId })).rows.map((r) => r.id)).toEqual([late.r.attemptId]);
    expect((await listAttempts({ ...page, q: '%' })).total).toBe(0);
    const refunds = await listRefunds();
    expect(refunds.map((r) => [r.state, r.merchantOrderId])).toEqual([
      ['task', late.r.merchantOrderId],
      ['completed', paid.r.merchantOrderId],
    ]);
    expect((await listOpenBankTransfers()).map((a) => a.id)).toEqual([bank.r.attemptId]);
    expect((await attemptsForOrder(paid.order.id)).map((a) => a.attemptNo)).toEqual([1]);
  });
});

describe('admin settings action and health', () => {
  it('test connection gets a token in mock mode and names the webhook URL', async () => {
    const res = await testConnectionAction();
    expect(res.ok).toBe(true);
    expect(res.detail).toMatchObject({ mode: 'mock', webhookUrl: `${harness.origin}/api/webhooks/phonepe` });
    expect(await gatewayHealth()).toMatchObject({ status: 'ok' });
    await setSettings(settingsDef, { mode: 'live' }, { actorId: null });
    expect(await gatewayHealth()).toMatchObject({ status: 'not_configured' });
    expect(await testConnectionAction()).toMatchObject({ ok: false });
  });

  it('anomaly health is down when attempts stay open past their window', async () => {
    expect(await anomalyHealth()).toEqual({ status: 'ok' });
    const { r } = await start(10000);
    await t.db.update(paymentsAttempt).set({ expiresAt: new Date(Date.now() - 20 * MIN) }).where(eq(paymentsAttempt.id, r.attemptId));
    expect(await anomalyHealth()).toMatchObject({ status: 'down' });
  });
});
