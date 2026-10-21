import { asCustomer, asGuest } from './viewers';
import { newId } from '@ecomkit/core/ids';
import type { TestDb } from '@ecomkit/core/testing';
import { computeTotals } from '@ecomkit/core/totals';
import { customersConsent } from '@ecomkit/customers/schema';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { checkoutSession } from '../src/schema';
import { checkoutContact, configureCheckout, placeOrder, quote, retryPayment, saveContact, setMarketingConsent } from '../src/server';
import { ADDRESS, CORE_FIXTURE, checkoutDb, outboxEvents, wire } from './helpers';

let t: TestDb;

beforeAll(async () => {
  t = await checkoutDb('main');
});
afterAll(async () => {
  await t?.close();
});
beforeEach(() => asGuest());

const sessionFor = async (cartId: string) => (await t.db.select().from(checkoutSession).where(eq(checkoutSession.cartId, cartId)))[0];
const orderSeq = async () => Number((await t.db.execute<{ value: string }>(sql`select coalesce(max(value), 0) as value from core_sequence where name = 'order'`)).rows[0]!.value);
const consents = async () => t.db.select().from(customersConsent);
const form = (over: Record<string, unknown> = {}) => ({
  idempotencyKey: newId(),
  name: 'Asha',
  phone: '98765 43210',
  email: 'asha@example.test',
  address: ADDRESS,
  methodId: 'local',
  paymentChoice: 'online' as const,
  policyAck: true,
  ...over,
});

describe('quote', () => {
  it('equals the core computeTotals fixture exactly (intra-state)', async () => {
    wire(newId());
    const q = await quote({ address: { pincode: '560001', districtSlug: 'bengaluru-urban', stateCode: 'KA' }, methodId: 'local' });
    expect(q.totals).toEqual(computeTotals(CORE_FIXTURE));
    expect(q.totals.totalPaise).toBe(2_015_000);
    expect(q.method?.methodId).toBe('local');
    expect(q.paymentChoices).toEqual(['online', 'partial_advance']);
    expect(q.advancePaise).toBe(604_500);
  });

  it('switches to IGST for a delivery outside the seller state without changing the total', async () => {
    wire(newId());
    const q = await quote({ address: { pincode: '600001', stateCode: 'TN' }, methodId: 'local' });
    expect(q.totals).toEqual(computeTotals({ ...CORE_FIXTURE, interState: true }));
    expect(q.totals.tax).toMatchObject({ cgstPaise: 0, sgstPaise: 0, igstPaise: 34_794 });
  });

  it('pickup drops transport; an empty cart is refused', async () => {
    const h = wire(newId());
    const q = await quote({ methodId: 'pickup' });
    expect(q.totals).toMatchObject({ transportPaise: 0, packingPaise: 20_000, totalPaise: 2_015_000 - 150_000 });
    h.cart = null;
    await expect(quote({})).rejects.toMatchObject({ code: 'cart_empty' });
  });

  it('validates the coupon once, then re-quotes reuse it (no extra coupon attempts)', async () => {
    const cartId = newId();
    wire(cartId);
    let calls = 0;
    const { getCheckoutPorts } = await import('../src/server');
    const d = getCheckoutPorts().discounts!;
    configureCheckout({ discounts: { ...d, coupon: async (...a) => (calls++, d.coupon(...a)) } });
    await quote({ methodId: 'local' });
    await quote({ methodId: 'pickup' });
    await quote({ address: { pincode: '560002' } });
    expect(calls).toBe(1);
    expect((await sessionFor(cartId))?.methodId).toBe('pickup'); // the last chosen method sticks across an address change
  });
});

describe('contact autosave and consent', () => {
  it('saves the contact on blur, emits checkout.started once and checkout.contact_saved per new contact, writes no consent', async () => {
    const cartId = newId();
    wire(cartId);
    const before = (await consents()).length;
    const first = await saveContact({ name: 'Asha', phone: '98765 43210', email: '' });
    expect(first.changed).toBe(true);
    expect((await saveContact({ name: 'Asha', phone: '+919876543210', email: null })).changed).toBe(false);
    await saveContact({ name: 'Asha K', phone: '+919876543210', email: null });
    await saveContact({ name: 'Asha K', phone: '+919876543210', email: 'asha@example.test' });
    const session = await sessionFor(cartId);
    expect(session?.contact).toEqual({ name: 'Asha K', phone: '+919876543210', email: 'asha@example.test', marketingConsent: false });
    const mine = (e: { payload: Record<string, unknown> }) => e.payload.cartId === cartId;
    expect((await outboxEvents(t, 'checkout.started')).filter(mine)).toHaveLength(1);
    const saved = (await outboxEvents(t, 'checkout.contact_saved')).filter(mine);
    expect(saved.map((e) => e.payload.email)).toEqual([null, 'asha@example.test']);
    expect(saved[0]!.payload).toMatchObject({ checkoutSessionId: session!.id, phone: '+919876543210' });
    expect((await consents()).length).toBe(before);
    expect(await checkoutContact(session!.id)).toMatchObject({ cartId, orderId: null, contact: { phone: '+919876543210' } });
  });

  it('notes the contact on the cart (abandoned-cart hasContact) only when a phone or email is saved', async () => {
    const cartId = newId();
    const h = wire(cartId);
    await saveContact({ name: 'Asha', phone: null, email: null });
    expect(h.contacted).toEqual([]);
    await saveContact({ name: 'Asha', phone: '98765 43210', email: null });
    await saveContact({ name: 'Asha K', phone: '98765 43210', email: null });
    expect(h.contacted).toEqual([cartId]);
  });

  it('a bad phone is a validation error, not a stored value', async () => {
    wire(newId());
    await expect(saveContact({ name: 'x', phone: '12345', email: null })).rejects.toThrow();
  });

  it('the marketing checkbox records a grant and a revocation with the exact text, only once a contact exists', async () => {
    const cartId = newId();
    wire(cartId);
    expect(await setMarketingConsent(true)).toEqual({ recorded: false });
    await saveContact({ name: 'Ravi', phone: '9123456789', email: null });
    expect(await setMarketingConsent(true, { ip: '203.0.113.9', userAgent: 'vitest' })).toEqual({ recorded: true });
    expect(await setMarketingConsent(true)).toEqual({ recorded: false });
    expect(await setMarketingConsent(false)).toEqual({ recorded: true });
    const rows = (await consents()).filter((r) => r.purpose === 'marketing' && r.source === 'checkout' && r.userAgent === 'vitest');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textShown).toMatch(/^2026-10: Send me offers/);
    expect(rows[0]!.ipHash).not.toContain('203.0.113.9');
    expect((await sessionFor(cartId))?.contact).toMatchObject({ marketingConsent: false });
  });
});

describe('place order', () => {
  it('reprices, holds stock with the attempt TTL, snapshots lines, redeems discounts, records consent and starts payment', async () => {
    const cartId = newId();
    const h = wire(cartId);
    const res = await placeOrder(form({ marketingConsent: 'on' }));
    expect(res).toMatchObject({ ok: true, replay: false });
    if (!res.ok) throw new Error('place');
    expect(res.next).toBe(`https://pay.example.test/${res.orderId}`);
    expect(res.number).toMatch(/^T-\d{4}-\d{5}$/);

    const order = h.created[0]!;
    expect(order.totals).toMatchObject({ subtotalPaise: 2_580_000, tierSavingsPaise: 675_000, promoPaise: 10_000, couponPaise: 50_000, packingPaise: 20_000, shippingPaise: 150_000, totalPaise: 2_015_000, taxPaise: 34_794, chargesGstRatePct: 18 });
    expect(order.lines.map((l) => [l.snapshot.sku, l.qty, l.listUnitPaise, l.unitPaise, l.tierApplied, l.discountPaise, l.lineTotalPaise])).toEqual([
      ['SKU-A', 50, 49_000, 35_500, true, 50_000, 1_725_000],
      ['SKU-C', 2, 50_000, 50_000, false, 10_000, 90_000],
      ['SKU-B', 1, 30_000, 30_000, false, 0, 30_000],
    ]);
    expect(order).toMatchObject({ initialStatus: 'pending_payment', paymentMode: 'online', advancePaise: 2_015_000, contact: { phone: '+919876543210' }, attribution: { utm_source: 'test' } });
    expect(order.delivery).toMatchObject({ methodId: 'local', kind: 'local_slot', slotDate: '2026-10-24', vehicle: 'Small pickup' });
    expect(order.reservationId).toMatch(/^res-/);
    const held = h.inventory.reservations.get(order.reservationId!)!;
    expect(held).toEqual([{ variantId: 'v-plant', qty: 50 }, { variantId: 'v-compost', qty: 2 }, { variantId: 'v-bio', qty: 1 }]);
    expect(h.redeemed).toEqual([
      { orderId: res.orderId, customerId: null, phone: '+919876543210', discounts: [{ ruleId: 'compost-10', codeId: null, amountPaise: 10_000 }, { ruleId: 'SAVE500', codeId: 'code-1', amountPaise: 50_000 }] },
    ]);
    expect(h.starts).toEqual([{ orderId: res.orderId, amountPaise: 2_015_000 }]);
    expect(h.converted).toEqual([cartId]);
    const session = await sessionFor(cartId);
    expect(session).toMatchObject({ orderId: res.orderId, step: 'placed', slotDate: '2026-10-24' });
    const purposes = (await consents()).filter((c) => c.source === 'checkout' && c.textShown.includes('2026-10')).map((c) => c.purpose);
    expect(purposes).toEqual(expect.arrayContaining(['order_updates', 'marketing']));
  });

  it('idempotency: a replayed key returns the same order, also after the cart converted and under a concurrent double submit', async () => {
    const cartId = newId();
    const h = wire(cartId);
    const body = form();
    const [a, b] = await Promise.all([placeOrder(body), placeOrder(body)]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) throw new Error('place');
    expect(a.orderId).toBe(b.orderId);
    expect([a.replay, b.replay].sort()).toEqual([false, true]);
    const again = await placeOrder(body);
    expect(again).toMatchObject({ ok: true, replay: true, orderId: a.orderId, number: a.number, next: `/checkout/${a.orderId}/pay?t=tok-${a.orderId}` });
    expect(h.created).toHaveLength(1);
    expect(h.starts).toHaveLength(1);
  });

  it('idempotency: a signed-in buyer\'s key never replays their order to someone else', async () => {
    wire(newId());
    asCustomer();
    const body = form();
    const mine = await placeOrder(body);
    expect(mine.ok).toBe(true);
    asCustomer();
    expect(await placeOrder(body)).toEqual({ ok: false, formError: 'cart_empty' });
    asGuest();
    expect(await placeOrder(body)).toEqual({ ok: false, formError: 'cart_empty' });
  });

  it('oversell is blocked: no order, no number used, no consent, form stays fillable', async () => {
    const cartId = newId();
    const { fakeInventory } = await import('@ecomkit/core/testing');
    const h = wire(cartId, { inventory: fakeInventory({ 'v-bio': 'out_of_stock' }) });
    const seq = await orderSeq();
    const consentCount = (await consents()).length;
    const res = await placeOrder(form());
    expect(res).toEqual({ ok: false, formError: 'out_of_stock', shortages: [{ variantId: 'v-bio', requested: 1, available: 0 }] });
    expect(h.created).toEqual([]);
    expect(await orderSeq()).toBe(seq);
    expect((await consents()).length).toBe(consentCount);
    expect((await sessionFor(cartId))?.orderId ?? null).toBeNull();
    expect(h.converted).toEqual([]);
  });

  it('a discount that hit its limit meanwhile rolls the whole order back (number returned to the sequence)', async () => {
    const cartId = newId();
    const h = wire(cartId, { redeemFails: true });
    const seq = await orderSeq();
    expect(await placeOrder(form())).toEqual({ ok: false, formError: 'discount_unavailable' });
    expect(h.created).toHaveLength(1); // createOrder ran inside the transaction that rolled back
    expect(await orderSeq()).toBe(seq);
    expect((await sessionFor(cartId))?.orderId ?? null).toBeNull();
    expect(h.starts).toEqual([]);
  });

  it('refuses a stale total, a missing address for delivery, a full slot and a payment choice the mode does not allow', async () => {
    wire(newId());
    expect(await placeOrder(form({ expectedTotalPaise: 1 }))).toEqual({ ok: false, formError: 'price_changed' });
    expect(await placeOrder(form({ address: null }))).toEqual({ ok: false, formError: 'address_required' });
    expect(await placeOrder(form({ slotDate: '2026-10-31' }))).toEqual({ ok: false, formError: 'slot_unavailable' });
    expect(await placeOrder(form({ paymentChoice: 'pay_at_nursery' }))).toEqual({ ok: false, formError: 'payment_choice' });
    expect(await placeOrder(form({ methodId: 'outstation' }))).toEqual({ ok: false, formError: 'method_unavailable' });
    await expect(placeOrder(form({ policyAck: false }))).rejects.toThrow();
  });

  it('partial advance asks for 30% online now (rounded up to the rupee)', async () => {
    const h = wire(newId());
    const res = await placeOrder(form({ paymentChoice: 'partial_advance' }));
    expect(res.ok).toBe(true);
    expect(h.created[0]).toMatchObject({ paymentMode: 'partial_advance', advancePaise: 604_500, initialStatus: 'pending_payment' });
    expect(h.starts[0]?.amountPaise).toBe(604_500);
  });

  it('pay at the nursery (pickup only): confirmed at once, stock committed, no payment redirect', async () => {
    const h = wire(newId(), { codMode: 'pay_at_nursery' });
    asCustomer();
    const res = await placeOrder(form({ methodId: 'pickup', address: null, paymentChoice: 'pay_at_nursery' }));
    if (!res.ok) throw new Error(res.formError);
    expect(res.next).toBe(`/order/tok-${res.orderId}`);
    expect(h.created[0]).toMatchObject({ initialStatus: 'confirmed', paymentMode: 'pay_at_nursery', shippingAddress: null });
    expect(h.created[0]!.customerId).not.toBeNull();
    expect(h.inventory.reservations.size).toBe(0);
    expect(h.starts).toEqual([]);
  });

  it('without cart, orders or payments wired the store cannot take orders; an empty cart says so', async () => {
    const h = wire(newId());
    h.cart = null;
    expect(await placeOrder(form())).toEqual({ ok: false, formError: 'cart_empty' });
    configureCheckout({ payments: null });
    expect(await placeOrder(form())).toEqual({ ok: false, formError: 'unavailable' });
  });

  it('pay page retry: pending orders restart payment for the amount still due; others go to the order page', async () => {
    const h = wire(newId());
    const res = await placeOrder(form());
    if (!res.ok) throw new Error('place');
    expect(await retryPayment(res.orderId, 'wrong')).toBeNull();
    expect(await retryPayment(res.orderId, `tok-${res.orderId}`)).toBe(`https://pay.example.test/${res.orderId}`);
    expect(h.starts.at(-1)).toEqual({ orderId: res.orderId, amountPaise: 2_015_000 });
    h.orders.set(res.orderId, { ...h.orders.get(res.orderId)!, status: 'paid' });
    expect(await retryPayment(res.orderId, `tok-${res.orderId}`)).toBe(`/order/tok-${res.orderId}`);
  });
});
