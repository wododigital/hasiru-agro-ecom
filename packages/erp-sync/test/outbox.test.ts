import { newId } from '@ecomkit/core/ids';
import { setSettings } from '@ecomkit/core/settings';
import type { TestDb } from '@ecomkit/core/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { erpOutbox } from '../src/schema';
import {
  configureErpSync,
  enqueueOutbox,
  erpRefFor,
  erpSyncSettings,
  onLeadCreated,
  onOrderConfirmed,
  onOrderPaid,
  outboxCounts,
  outboxHealth,
  pendingOrderRows,
  pushDue,
  retryOutbox,
} from '../src/server';
import { erpDb, events, fakeAdapter, orderPayload, type FakeAdapter } from './helpers';

let t: TestDb;
let erp: FakeAdapter;
const orderNumbers = new Map<string, string>();
const pushed: { kind: string; refId: string; externalRef: string | null }[] = [];

const row = async (refId: string) => (await t.db.select().from(erpOutbox).where(eq(erpOutbox.refId, refId)))[0]!;
const newOrder = (n: string) => {
  const id = newId();
  orderNumbers.set(id, n);
  return id;
};

beforeAll(async () => {
  t = await erpDb('outbox');
});
afterAll(async () => {
  await t?.close();
});
beforeEach(async () => {
  await t.db.delete(erpOutbox);
  erp = fakeAdapter();
  pushed.length = 0;
  configureErpSync({
    adapter: async () => erp,
    orderPayload: async (id) => (orderNumbers.has(id) ? orderPayload(orderNumbers.get(id)!) : null),
    leadPayload: async (id) => ({ leadId: id, source: 'wizard', name: 'Lead', phone: '+919800000002', email: null, district: null, landAcres: 2, purpose: null, notes: null, createdAt: '2026-10-20T05:00:00.000Z' }),
    onPushed: async (p) => void pushed.push(p),
  });
  await setSettings(erpSyncSettings, { maxAttempts: 3, enabled: true }, { actorId: null });
});

describe('enqueue', () => {
  it('order.paid and order.confirmed for one order make exactly one row', async () => {
    const id = newOrder('T-0001');
    await onOrderPaid({ orderId: id, orderNumber: 'T-0001', amountPaise: 30000 as never, paymentAttemptId: null });
    await onOrderConfirmed({ orderId: id, orderNumber: 'T-0001' });
    expect((await enqueueOutbox({ kind: 'order', refId: id })).created).toBe(false);
    expect(await t.db.select().from(erpOutbox)).toHaveLength(1);
  });
});

describe('push', () => {
  it('pushes once, records the ERP ref, and a second run sends nothing (idempotent)', async () => {
    const id = newOrder('T-0002');
    await onOrderPaid({ orderId: id, orderNumber: 'T-0002', amountPaise: 30000 as never, paymentAttemptId: null });
    const first = await pushDue();
    expect(first).toMatchObject({ status: 'done', sent: 1 });
    const second = await pushDue();
    expect(second.sent).toBe(0);
    expect(erp.orders.map((o) => o.ecomOrderNumber)).toEqual(['T-0002']);
    const r = await row(id);
    expect(r).toMatchObject({ status: 'sent', externalRef: 'OPS-1', attempts: 0 });
    expect(r.payload).toMatchObject({ ecomOrderNumber: 'T-0002' });
    expect(await erpRefFor(id)).toEqual({ status: 'sent', externalRef: 'OPS-1', invoiceNumber: null });
    expect(pushed).toEqual([{ kind: 'order', refId: id, externalRef: 'OPS-1', invoiceNumber: null }]);
    expect((await events(t, 'erp.synced')).some((e) => e.payload.kind === 'orders' && e.payload.changed === 1)).toBe(true);
  });

  it('two workers running at once push each row once (skip locked)', async () => {
    erp.delayMs = 150;
    const ids = ['T-0101', 'T-0102', 'T-0103', 'T-0104'].map((n) => newOrder(n));
    for (const id of ids) await enqueueOutbox({ kind: 'order', refId: id });
    const [a, b] = await Promise.all([pushDue(), pushDue()]);
    expect(a.sent + b.sent).toBe(4);
    expect(erp.orders).toHaveLength(4);
    expect(new Set(erp.orders.map((o) => o.ecomOrderNumber)).size).toBe(4);
  });

  it('a failing ERP retries with backoff, then moves to dead letter and the critical health check goes down', async () => {
    erp.failPushes = 99;
    const id = newOrder('T-0003');
    await enqueueOutbox({ kind: 'order', refId: id });
    // fixed clock: the row is enqueued at real now(), so pin it to t0 or nothing is due once today passes 06:00Z
    const t0 = new Date('2026-10-20T06:00:00Z');
    await t.db.update(erpOutbox).set({ nextAttemptAt: t0 }).where(eq(erpOutbox.refId, id));
    expect((await pushDue({ now: t0 })).failed).toBe(1);
    let r = await row(id);
    expect(r).toMatchObject({ status: 'failed', attempts: 1 });
    expect(r.nextAttemptAt.getTime() - t0.getTime()).toBe(30_000);
    expect(r.lastError).toMatch(/503/);
    // Not due yet: nothing happens.
    expect((await pushDue({ now: new Date(t0.getTime() + 10_000) })).failed).toBe(0);
    await pushDue({ now: new Date(t0.getTime() + 31_000) });
    r = await row(id);
    expect(r.attempts).toBe(2);
    expect(r.nextAttemptAt.getTime() - (t0.getTime() + 31_000)).toBe(60_000);
    const last = await pushDue({ now: new Date(t0.getTime() + 200_000) });
    expect(last.dead).toBe(1);
    expect((await row(id)).status).toBe('dead');
    expect(await outboxHealth()).toMatchObject({ status: 'down' });
    expect(await outboxCounts()).toMatchObject({ dead: 1, waitingOrders: 0 });

    // Admin retry: fresh attempt budget, goes out once the ERP is back.
    erp.failPushes = 0;
    expect(await retryOutbox(r.id, newId())).toBe(true);
    expect((await pushDue()).sent).toBe(1);
    expect((await row(id)).status).toBe('sent');
    expect(await outboxHealth()).toMatchObject({ status: 'ok' });
  });

  it('waits without spending attempts while the ERP endpoint or the order source is not configured', async () => {
    erp.ordersNotConfigured = true;
    const id = newOrder('T-0004');
    await enqueueOutbox({ kind: 'order', refId: id });
    expect((await pushDue()).deferred).toBe(1);
    expect(await row(id)).toMatchObject({ status: 'pending', attempts: 0, lastError: 'orders endpoint not configured' });

    configureErpSync({ orderPayload: null });
    const id2 = newOrder('T-0005');
    await enqueueOutbox({ kind: 'order', refId: id2 });
    await pushDue();
    expect(await row(id2)).toMatchObject({ status: 'pending', attempts: 0, lastError: 'order source not configured' });
  });

  it('a payload that fails validation counts as a failed attempt and is never sent', async () => {
    const id = newId();
    configureErpSync({ orderPayload: async () => ({ ...orderPayload('T-0006'), lines: [] }) });
    await enqueueOutbox({ kind: 'order', refId: id });
    expect((await pushDue()).failed).toBe(1);
    expect((await row(id)).lastError).toMatch(/invalid order payload: lines/);
    expect(erp.orders).toHaveLength(0);
  });

  it('nothing moves with no adapter or with sync switched off', async () => {
    const id = newOrder('T-0007');
    await enqueueOutbox({ kind: 'order', refId: id });
    configureErpSync({ adapter: null });
    expect((await pushDue()).status).toBe('not_configured');
    configureErpSync({ adapter: async () => erp });
    await setSettings(erpSyncSettings, { enabled: false }, { actorId: null });
    expect((await pushDue()).status).toBe('disabled');
    expect((await row(id)).status).toBe('pending');
  });
});

describe('leads', () => {
  it('lead.created queues the lead once and pushes it', async () => {
    const leadId = newId();
    await onLeadCreated({ leadId, source: 'wizard' });
    await onLeadCreated({ leadId, source: 'wizard' });
    expect((await pushDue()).sent).toBe(1);
    expect(erp.leads).toEqual([leadId]);
    expect(pushed).toEqual([{ kind: 'lead', refId: leadId, externalRef: null, invoiceNumber: null }]);
  });
});

describe('manual bridge CSV', () => {
  it('lists orders not yet in the ERP, payload built on demand', async () => {
    erp.ordersNotConfigured = true;
    const id = newOrder('T-0008');
    await enqueueOutbox({ kind: 'order', refId: id });
    const rows = await pendingOrderRows();
    expect(rows[0]).toContain('order_number');
    expect(rows[1]).toEqual(expect.arrayContaining(['T-0008', 'Test Buyer', '+919800000001', 'SKU-1 x 2', '30000', 'pending']));
    expect((await row(id)).payload).not.toBeNull();
  });
});
