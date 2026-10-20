import { newId } from '@ecomkit/core/ids';
import { setSettings } from '@ecomkit/core/settings';
import { TEST_NOW, type TestDb } from '@ecomkit/core/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cartCart } from '../src/schema';
import { addLine, cartSettings, findCart, markAbandoned, noteContact, removeLine, restoreCart, restorePath, restoreToken, getCartView, type CartContext } from '../src/server';
import { markAbandonedJob } from '../src/server/jobs';
import { bind, cartDb, makeVariant, outboxEvents } from './helpers';

let t: TestDb;
const at = (min: number) => new Date(TEST_NOW.getTime() + min * 60_000);
const ctx = (token: string | null, min: number, customerId: string | null = null): CartContext => ({ token, customerId, now: at(min) });

beforeAll(async () => {
  t = await cartDb('abandon');
}, 120_000);

afterAll(async () => {
  await t?.close();
});

beforeEach(async () => {
  bind();
  // Carts from earlier tests are older than any cutoff here; close them so each test counts only its own.
  await t.db.update(cartCart).set({ status: 'converted' });
});

const abandonedEvents = async () => (await outboxEvents(t, 'cart.abandoned')).map((e) => e.payload);

describe('abandoned carts', () => {
  it('marks a cart with lines abandoned once after the idle window (default 60 min), and activity re-opens it', async () => {
    const v = await makeVariant(t, { listPaise: 10_000 });
    const first = await addLine(ctx(null, 0), { variantId: v.variantId, qty: 2 });
    const token = first.issuedToken!;
    const before = (await abandonedEvents()).length;

    expect(await markAbandoned({ now: at(59) })).toBe(0);
    expect(await markAbandoned({ now: at(60) })).toBe(1);
    expect(await markAbandoned({ now: at(61) })).toBe(0); // once per idle stretch
    let events = (await abandonedEvents()).slice(before);
    expect(events).toEqual([{ cartId: first.cartId, checkoutSessionId: null, hasContact: false }]);
    const [row] = await t.db.select().from(cartCart).where(eq(cartCart.id, first.cartId));
    expect(row).toMatchObject({ status: 'abandoned', abandonedAt: at(60) });

    // The shopper comes back: the same cart opens, becomes active, and can be abandoned again later.
    expect((await findCart(ctx(token, 90)))!.id).toBe(first.cartId);
    await addLine(ctx(token, 90), { variantId: v.variantId, qty: 1 });
    expect((await t.db.select().from(cartCart).where(eq(cartCart.id, first.cartId)))[0]!.status).toBe('active');
    expect(await markAbandoned({ now: at(149) })).toBe(0);
    expect(await markAbandoned({ now: at(150) })).toBe(1);
    events = (await abandonedEvents()).slice(before);
    expect(events).toHaveLength(2);
  });

  it('never abandons an empty cart, and follows the admin setting', async () => {
    const v = await makeVariant(t, { listPaise: 10_000 });
    const m = await addLine(ctx(null, 0), { variantId: v.variantId, qty: 1 });
    const line = (await getCartView(ctx(m.issuedToken, 0)))!.lines[0]!;
    await removeLine(ctx(m.issuedToken, 0), line.lineId);
    expect(await markAbandoned({ now: at(600) })).toBe(0);

    await setSettings(cartSettings, { abandonAfterMinutes: 30 }, { actorId: null });
    try {
      await addLine(ctx(null, 0), { variantId: v.variantId, qty: 1 });
      expect(await markAbandoned({ now: at(29) })).toBe(0);
      expect(await markAbandoned({ now: at(30) })).toBe(1);
    } finally {
      await setSettings(cartSettings, { abandonAfterMinutes: 60 }, { actorId: null });
    }
  });

  it('payload hasContact: a signed-in customer or a contact saved at checkout', async () => {
    const v = await makeVariant(t, { listPaise: 10_000 });
    const customer = await addLine(ctx(null, 0, newId()), { variantId: v.variantId, qty: 1 });
    const contact = await addLine(ctx(null, 0), { variantId: v.variantId, qty: 1 });
    await noteContact(contact.cartId, { now: at(1) });
    const anon = await addLine(ctx(null, 0), { variantId: v.variantId, qty: 1 });
    const before = (await abandonedEvents()).length;
    expect(await markAbandoned({ now: at(120) })).toBe(3);
    const byCart = Object.fromEntries((await abandonedEvents()).slice(before).map((p) => [p.cartId, p.hasContact]));
    expect(byCart).toEqual({ [customer.cartId]: true, [contact.cartId]: true, [anon.cartId]: false });
  });

  it('the scheduled job drains every idle cart', async () => {
    const v = await makeVariant(t, { listPaise: 10_000 });
    const old = new Date(Date.now() - 3 * 3_600_000);
    for (let i = 0; i < 3; i++) await addLine({ token: null, customerId: null, now: old }, { variantId: v.variantId, qty: 1 });
    const logged: unknown[] = [];
    await markAbandonedJob({}, { jobId: 'j', queue: 'cart.mark-abandoned', attempt: 1, log: { info: (_m, d) => logged.push(d), warn: () => {}, error: () => {} } });
    expect(logged).toEqual([{ carts: 3 }]);
  });
});

describe('restore links', () => {
  it('opens a guest cart on another device with a fresh cookie and merges what that device had', async () => {
    const v = await makeVariant(t, { listPaise: 10_000 });
    const w = await makeVariant(t, { listPaise: 20_000 });
    const original = await addLine(ctx(null, 0), { variantId: v.variantId, qty: 4 });
    const link = await restoreToken(original.cartId, { now: at(0) });
    expect(restorePath(link)).toMatch(/^\/api\/cart\/restore\?t=/);

    const phone = await addLine(ctx(null, 5), { variantId: w.variantId, qty: 1 });
    const r = await restoreCart(ctx(phone.issuedToken, 70), link);
    expect(r).toMatchObject({ ok: true, cartId: original.cartId });
    const issued = (r as { issuedToken: string }).issuedToken;
    const view = (await getCartView(ctx(issued, 70)))!;
    expect(view.cartId).toBe(original.cartId);
    expect(view.lines.map((l) => [l.variantId, l.qty]).sort()).toEqual([[v.variantId, 4], [w.variantId, 1]].sort());
    // The old cookie stops working; the phone's own cart was merged in.
    expect(await findCart(ctx(original.issuedToken, 70))).toBeNull();
    expect((await t.db.select().from(cartCart).where(eq(cartCart.id, phone.cartId)))[0]!.status).toBe('merged');
  });

  it('refuses tampered and expired links, gone carts, and someone else\'s customer cart', async () => {
    const v = await makeVariant(t, { listPaise: 10_000 });
    const guestCart = await addLine(ctx(null, 0), { variantId: v.variantId, qty: 1 });
    const link = await restoreToken(guestCart.cartId, { now: at(0) });
    expect(await restoreCart(ctx(null, 1), link.replace(/.$/, (c) => (c === '0' ? '1' : '0')))).toEqual({ ok: false, reason: 'invalid' });
    expect(await restoreCart(ctx(null, 31 * 24 * 60), link)).toEqual({ ok: false, reason: 'expired' });
    await t.db.update(cartCart).set({ status: 'converted' }).where(eq(cartCart.id, guestCart.cartId));
    expect(await restoreCart(ctx(null, 1), link)).toEqual({ ok: false, reason: 'gone' });

    const owner = newId();
    const theirs = await addLine(ctx(null, 0, owner), { variantId: v.variantId, qty: 1 });
    const theirLink = await restoreToken(theirs.cartId, { now: at(0) });
    expect(await restoreCart(ctx(null, 1), theirLink)).toEqual({ ok: false, reason: 'sign_in' });
    expect(await restoreCart(ctx(null, 1, owner), theirLink)).toEqual({ ok: true, cartId: theirs.cartId, issuedToken: null });
  });
});
