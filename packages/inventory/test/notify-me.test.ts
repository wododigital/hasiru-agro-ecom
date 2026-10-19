import type { NotificationSender } from '@ecomkit/core/contracts';
import { newId } from '@ecomkit/core/ids';
import type { TestDb } from '@ecomkit/core/testing';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { POST } from '../src/routes/notify-me';
import { inventorySubscription } from '../src/schema';
import { notifyBackInStock, onStockChanged, setFromErp, setNotificationsProvider, subscribe, SubscribeError } from '../src/server';
import { inventoryDb, makeLevel } from './helpers';

let t: TestDb;

beforeAll(async () => {
  t = await inventoryDb('notify');
});

afterAll(async () => {
  await t?.close();
});

afterEach(() => setNotificationsProvider(async () => null));

function recorder(failOn?: string) {
  const sent: { to: { phone?: string | null; email?: string | null }; vars: Record<string, string | number> }[] = [];
  const sender: NotificationSender = {
    async send(templateKey, to, vars) {
      expect(templateKey).toBe('stock.back_in_stock');
      if (failOn && (to.email === failOn || to.phone === failOn)) throw new Error('provider down');
      sent.push({ to, vars: { ...vars } });
      return { messageIds: [newId()] };
    },
  };
  return { sender, sent };
}

let ip = 0;
const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request('http://localhost/api/notify-me', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': `10.0.0.${++ip}`, ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

describe('subscribe', () => {
  it('normalises the phone, dedupes per contact and re-arms after a notification', async () => {
    const v = await makeLevel(0);
    const a = await subscribe({ variantId: v.variantId, phone: '098765 43210', consent: true });
    const b = await subscribe({ variantId: v.variantId, phone: '+91 98765 43210', consent: true });
    expect(b.subscriptionId).toBe(a.subscriptionId);
    const [row] = await t.db.select().from(inventorySubscription).where(eq(inventorySubscription.id, a.subscriptionId));
    expect(row).toMatchObject({ phone: '+919876543210', email: null, productId: v.productId, notifiedAt: null });

    await t.db.update(inventorySubscription).set({ notifiedAt: new Date() }).where(eq(inventorySubscription.id, a.subscriptionId));
    await subscribe({ variantId: v.variantId, phone: '9876543210', consent: true });
    const [again] = await t.db.select().from(inventorySubscription).where(eq(inventorySubscription.id, a.subscriptionId));
    expect(again?.notifiedAt).toBeNull();
  });

  it('refuses an unknown variant, a bad phone, a missing contact and missing consent', async () => {
    const v = await makeLevel(0);
    await expect(subscribe({ variantId: newId(), email: 'a@example.com', consent: true })).rejects.toMatchObject({ code: 'unknown_variant' });
    await expect(subscribe({ variantId: v.variantId, phone: '12345', consent: true })).rejects.toBeInstanceOf(SubscribeError);
    await expect(subscribe({ variantId: v.variantId, consent: true })).rejects.toThrow();
    await expect(subscribe({ variantId: v.variantId, email: 'a@example.com', consent: false })).rejects.toThrow();
  });
});

describe('back in stock delivery', () => {
  it('sends once per subscriber when stock returns, and nothing while out of stock', async () => {
    const v = await makeLevel(0);
    await subscribe({ variantId: v.variantId, email: 'One@Example.com', consent: true });
    await subscribe({ variantId: v.variantId, phone: '9876500001', consent: true });
    const { sender, sent } = recorder();
    setNotificationsProvider(async () => sender);

    expect(await notifyBackInStock(v.variantId)).toEqual({ sent: 0, pending: 0 });
    await setFromErp([{ variantId: v.variantId, onHand: 5 }]);
    await onStockChanged({ productId: v.productId, variantId: v.variantId, available: 5 }, { eventId: newId(), emittedAt: new Date(), log: console });
    expect(sent.map((s) => s.to.email ?? s.to.phone).sort()).toEqual(['+919876500001', 'one@example.com']);
    expect(sent[0]?.vars).toMatchObject({ productId: v.productId, variantId: v.variantId });
    expect(await notifyBackInStock(v.variantId)).toEqual({ sent: 0, pending: 0 });
    expect(sent).toHaveLength(2);
  });

  it('keeps subscriptions pending when no notifications module is bound', async () => {
    const v = await makeLevel(3);
    await subscribe({ variantId: v.variantId, email: 'wait@example.com', consent: true });
    expect(await notifyBackInStock(v.variantId)).toEqual({ sent: 0, pending: 1 });
  });

  it('a failed send un-claims the unsent rows so the retry delivers them', async () => {
    const v = await makeLevel(2);
    await subscribe({ variantId: v.variantId, email: 'fail@example.com', consent: true });
    const failing = recorder('fail@example.com');
    setNotificationsProvider(async () => failing.sender);
    await expect(notifyBackInStock(v.variantId)).rejects.toThrow('provider down');
    const ok = recorder();
    setNotificationsProvider(async () => ok.sender);
    expect(await notifyBackInStock(v.variantId)).toEqual({ sent: 1, pending: 0 });
  });
});

describe('POST /api/notify-me', () => {
  it('201 on a valid request, 400 on bad input, 404 on an unknown variant', async () => {
    const v = await makeLevel(0);
    expect((await post({ variantId: v.variantId, email: 'route@example.com', consent: true })).status).toBe(201);
    const bad = await post({ variantId: v.variantId, consent: true });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ ok: false, fieldErrors: { phone: expect.any(Array) } });
    expect((await post({ variantId: v.variantId, phone: '123', consent: true })).status).toBe(400);
    expect((await post({ variantId: newId(), email: 'x@example.com', consent: true })).status).toBe(404);
    expect((await post('{not json')).status).toBe(400);
    expect((await post({ variantId: v.variantId, email: 'x@example.com', consent: true, pad: 'x'.repeat(5000) })).status).toBe(413);
  });

  it('a filled honeypot gets 202 and stores nothing', async () => {
    const v = await makeLevel(0);
    const res = await post({ variantId: v.variantId, email: 'bot@example.com', consent: true, website: 'http://spam' });
    expect(res.status).toBe(202);
    expect(await t.db.select().from(inventorySubscription).where(eq(inventorySubscription.variantId, v.variantId))).toHaveLength(0);
  });

  it('caps pending alerts per contact at 5 variants', async () => {
    const codes: string[] = [];
    for (let i = 0; i < 6; i++) {
      const v = await makeLevel(0);
      codes.push(await subscribe({ variantId: v.variantId, email: 'victim@example.com', consent: true }).then(() => 'ok', (e) => e.code));
    }
    expect(codes).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'too_many']);
  });

  it('rate limits 10 requests per hour per IP', async () => {
    const v = await makeLevel(0);
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await post({ variantId: v.variantId, email: `r${i}@example.com`, consent: true }, { 'x-real-ip': '10.9.9.9' })).status);
    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
