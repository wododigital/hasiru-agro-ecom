import { NotConfiguredError } from '@ecomkit/core/http';
import { newId } from '@ecomkit/core/ids';
import type { TestDb } from '@ecomkit/core/testing';
import { setSettings } from '@ecomkit/core/settings';
import { erpOutbox } from '@ecomkit/erp-sync/schema';
import { configureErpSync, pullInventory, pushDue } from '@ecomkit/erp-sync/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { opsSettingsSchema, type OpsSettings } from '../src/domain';
import { GET, opsMockState, POST, resetOpsMock } from '../src/mocks/hasiru-ops';
import { createOpsAdapter, opsSettings, OpsHttpError, signRequest, type Http } from '../src/server';
import { opsDb } from './helpers';

/** Routes the adapter's real HTTP calls into the mock route handler in-process (what the dev server does over HTTP). */
const http: Http = (url, init) => {
  const req = new Request(url, { method: init.method, headers: init.headers, ...(init.body ? { body: init.body } : {}) });
  return init.method === 'GET' ? GET(req) : POST(req);
};
const mockSettings: OpsSettings = opsSettingsSchema.parse({ transport: 'mock' });
const order = (n: string) => ({
  ecomOrderNumber: n,
  placedAt: '2026-10-20T05:00:00.000Z',
  customer: { name: 'Buyer', phone: '+919800000001', email: null, gstin: null },
  deliver: { method: 'pickup', slotDate: null, district: null, address: 'Pickup' },
  lines: [{ erpItemId: '00000000-0000-4000-8000-000000000001', sku: 'S-1', name: 'Mango', qty: 3, unitPaise: 10000 as never, lineTotalPaise: 30000 as never }],
  totals: { subtotalPaise: 30000 as never, discountPaise: 0 as never, shippingPaise: 0 as never, taxPaise: 0 as never, totalPaise: 30000 as never, paidPaise: 30000 as never },
  status: 'paid',
});

let t: TestDb;
beforeAll(async () => {
  t = await opsDb('ops-adapter');
});
afterAll(async () => {
  await t?.close();
});
beforeEach(() => resetOpsMock());

describe('mock transport over signed HTTP', () => {
  it('pulls all 200 mock items across keyset pages, and the drift toggle shifts stock', async () => {
    const a = createOpsAdapter(mockSettings, { http });
    const ids: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    const firstAvail: number[] = [];
    do {
      const page = await a.pullInventory({ since: null, cursor });
      ids.push(...page.items.map((i) => i.erpItemId));
      if (pages === 0) firstAvail.push(...page.items.map((i) => i.available));
      cursor = page.nextCursor;
      pages++;
    } while (cursor);
    expect(ids).toHaveLength(200);
    expect(new Set(ids).size).toBe(200);
    expect(pages).toBe(3);
    opsMockState().drift = true;
    const drifted = await a.pullInventory({ since: null, cursor: null });
    expect(drifted.items[0]!.available).toBe(firstAvail[0]! + 3);
    expect(drifted.items[1]!.available).toBe(firstAvail[1]);
  });

  it('pushes an order idempotently on ecomOrderNumber', async () => {
    const a = createOpsAdapter(mockSettings, { http });
    const first = await a.pushOrder(order('T-0001'));
    const again = await a.pushOrder(order('T-0001'));
    expect(first).toEqual({ opsOrderId: 'OPS-00001', invoiceNumber: null });
    expect(again).toEqual(first);
    expect(opsMockState().orders.get('T-0001')?.pushes).toBe(2);
    opsMockState().failOrders = 1;
    await expect(a.pushOrder(order('T-0002'))).rejects.toMatchObject({ name: 'OpsHttpError', status: 503 });
  });

  it('the mock rejects a tampered body, a stale timestamp and a replayed nonce', async () => {
    const { mockSecret } = await import('../src/server');
    const url = 'http://127.0.0.1:3000/api/_mock/hasiru-ops/api/ecom/orders';
    const body = JSON.stringify(order('T-0003'));
    const headers = signRequest({ method: 'POST', path: '/api/_mock/hasiru-ops/api/ecom/orders', body, secret: mockSecret() });
    const send = (h: Record<string, string>, b = body) => POST(new Request(url, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: b }));
    expect((await send(headers, body.replace('T-0003', 'T-0004'))).status).toBe(401);
    expect((await send(headers)).status).toBe(201);
    expect((await send(headers)).status).toBe(401);
    const old = signRequest({ method: 'POST', path: '/api/_mock/hasiru-ops/api/ecom/orders', body, secret: mockSecret(), now: new Date(Date.now() - 6 * 60_000) });
    expect((await send(old)).status).toBe(401);
    const wrongKey = signRequest({ method: 'POST', path: '/api/_mock/hasiru-ops/api/ecom/orders', body, secret: 'not-the-secret' });
    expect((await send(wrongKey)).status).toBe(401);
  });

  it('sends leads to the intake endpoint with the shared-secret header', async () => {
    const a = createOpsAdapter(mockSettings, { http });
    const leadId = newId();
    expect(await a.pushLead({ leadId, source: 'enquiry', name: 'Farmer', phone: '+919800000009', email: null, district: 'Sample', landAcres: 3, purpose: 'Farm development', notes: null, createdAt: '2026-10-20T05:00:00.000Z' })).toEqual({ externalId: null });
    expect(opsMockState().leads).toEqual([
      expect.objectContaining({ name: 'Farmer', phone: '+919800000009', source: 'ecom-enquiry', lead_type: 'service', message: expect.stringContaining(leadId) }),
    ]);
  });

  it('is not configured without endpoints, and test connection says so', async () => {
    const live = createOpsAdapter(opsSettingsSchema.parse({ transport: 'ops-api' }), { http });
    await expect(live.pushOrder(order('T-0005'))).rejects.toBeInstanceOf(NotConfiguredError);
    await expect(live.pushLead({ leadId: newId(), source: 'wizard', name: null, phone: '+919800000001', email: null, district: null, landAcres: null, purpose: null, notes: null, createdAt: '2026-10-20T05:00:00.000Z' })).rejects.toBeInstanceOf(NotConfiguredError);
    expect(await live.testConnection()).toMatchObject({ ok: false });
    expect(await createOpsAdapter(mockSettings, { http }).testConnection()).toMatchObject({ ok: true, message: expect.stringMatching(/Stock feed OK/) });
    expect(OpsHttpError).toBeDefined();
  });
});

describe('with erp-sync', () => {
  it('pull and push run end to end through the mock: one ops order per store order however often it is pushed', async () => {
    await setSettings(opsSettings, { transport: 'mock' }, { actorId: null });
    const orderId = newId();
    configureErpSync({ adapter: async () => createOpsAdapter(mockSettings, { http }), orderPayload: async (id) => (id === orderId ? order('T-0100') : null) });
    const pulled = await pullInventory({ force: true });
    expect(pulled).toMatchObject({ status: 'done', items: 200 });

    await t.db.insert(erpOutbox).values({ kind: 'order', refId: orderId });
    expect((await pushDue()).sent).toBe(1);
    expect((await pushDue()).sent).toBe(0);
    expect(opsMockState().orders.get('T-0100')).toMatchObject({ opsOrderId: 'OPS-00001', pushes: 1 });
  });
});
