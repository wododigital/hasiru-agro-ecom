import type { AppliedDiscountInput, Paise, TotalsInput } from '@ecomkit/core/contracts';
import { newId } from '@ecomkit/core/ids';
import { fakeInventory, fakeShippingQuote, TEST_NOW, type TestDb } from '@ecomkit/core/testing';
import { computeTotals } from '@ecomkit/core/totals';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cartCart } from '../src/schema';
import {
  addLine,
  applyCoupon,
  cartCount,
  CartError,
  changeQty,
  findCart,
  getCartView,
  markConverted,
  removeLine,
  replacePackage,
  setDeliveryMethod,
  setQty,
  storeCoupon,
  type CartContext,
} from '../src/server';
import { bind, cartDb, fakeDiscounts, makeVariant, outboxEvents } from './helpers';

let t: TestDb;
const guest = (token: string | null = null): CartContext => ({ token, customerId: null, now: TEST_NOW });
const P = (n: number) => n as Paise;

beforeAll(async () => {
  t = await cartDb('cart');
}, 120_000);

afterAll(async () => {
  await t?.close();
});

beforeEach(() => bind());

/** Adds and returns the new cart's token. */
async function newCart(variantId: string, qty: number): Promise<string> {
  const m = await addLine(guest(), { variantId, qty });
  expect(m.issuedToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  return m.issuedToken!;
}

describe('cookie cart and lines', () => {
  it('creates a cart on first add, keeps only the token hash, and sums repeated adds', async () => {
    const v = await makeVariant(t, { listPaise: 49_000 });
    const token = await newCart(v.variantId, 2);
    const again = await addLine(guest(token), { variantId: v.variantId, qty: 3 });
    expect(again.issuedToken).toBeNull();
    expect(again.result).toBe(5);
    const rows = await t.db.select().from(cartCart).where(eq(cartCart.id, again.cartId));
    expect(rows[0]!.cookieTokenHash).not.toContain(token);
    expect(await cartCount(guest(token))).toBe(5);
  });

  it('changeQty follows the catalog button contract: +delta adds, -delta lowers, 0 removes', async () => {
    const v = await makeVariant(t, { listPaise: 10_000 });
    const first = await changeQty(guest(), { variantId: v.variantId, delta: 1 });
    const token = first.issuedToken!;
    expect((await changeQty(guest(token), { variantId: v.variantId, delta: 9 })).result).toBe(10);
    expect((await changeQty(guest(token), { variantId: v.variantId, delta: -4 })).result).toBe(6);
    expect((await changeQty(guest(token), { variantId: v.variantId, delta: -6 })).result).toBe(0);
    expect((await getCartView(guest(token)))!.lines).toEqual([]);
    // A decrement without any cart creates nothing.
    expect(await changeQty(guest(), { variantId: v.variantId, delta: -1 })).toEqual({ cartId: null, issuedToken: null, result: 0 });
  });

  it('refuses unknown and unpurchasable variants', async () => {
    const off = await makeVariant(t, { listPaise: 10_000, purchasable: false });
    await expect(addLine(guest(), { variantId: newId(), qty: 1 })).rejects.toMatchObject({ code: 'unknown_variant' });
    await expect(addLine(guest(), { variantId: off.variantId, qty: 1 })).rejects.toBeInstanceOf(CartError);
  });

  it('fills weightKg from the variant, or from origin.weightKg when planting sets it', async () => {
    const v = await makeVariant(t, { listPaise: 10_000, weightKg: 2.5 });
    const token = await newCart(v.variantId, 4);
    await replacePackage(guest(token), { packageId: 'plan-1', lines: [{ variantId: v.variantId, qty: 10, origin: { source: 'planting', modelSlug: 'miyawaki', weightKg: 0.8 } }] });
    const view = (await getCartView(guest(token)))!;
    const byKind = Object.fromEntries(view.blockLines.map((l) => [l.kind, l]));
    expect(byKind.product).toMatchObject({ weightKg: 2.5, qty: 4, packageId: null });
    expect(byKind.package).toMatchObject({ weightKg: 0.8, qty: 10, packageId: 'plan-1', origin: { source: 'planting', modelSlug: 'miyawaki', weightKg: 0.8 } });
    expect(view.totals!.totalWeightKg).toBe(18);
  });

  it('setQty and removeLine only touch lines of the visitor\'s own cart (no IDOR)', async () => {
    const v = await makeVariant(t, { listPaise: 10_000 });
    const mine = await newCart(v.variantId, 1);
    const theirs = await newCart(v.variantId, 7);
    const theirLine = (await getCartView(guest(theirs)))!.lines[0]!.lineId;
    expect(await setQty(guest(mine), { lineId: theirLine, qty: 1 })).toBeNull();
    expect(await removeLine(guest(mine), theirLine)).toBeNull();
    expect((await getCartView(guest(theirs)))!.lines[0]!.qty).toBe(7);
    const myLine = (await getCartView(guest(mine)))!.lines[0]!.lineId;
    expect(await setQty(guest(mine), { lineId: myLine, qty: 12 })).toBe(12);
    expect(await removeLine(guest(mine), myLine)).toBe(0);
  });

  it('a converted cart is never served again', async () => {
    const v = await makeVariant(t, { listPaise: 10_000 });
    const token = await newCart(v.variantId, 1);
    const cart = (await findCart(guest(token)))!;
    expect(await markConverted(cart.id, newId())).toBe(true);
    expect(await findCart(guest(token))).toBeNull();
    expect(await markConverted(cart.id, newId())).toBe(false);
  });
});

describe('packages and bulk tiers', () => {
  it('sums the same plant across package and extra lines for the tier (cross-line summation)', async () => {
    const v = await makeVariant(t, { listPaise: 49_000, tiers: [{ minQty: 50, unitPaise: 35_500 }, { minQty: 100, unitPaise: 34_000 }] });
    const token = await newCart(v.variantId, 25);
    await replacePackage(guest(token), { packageId: 'plan-a', lines: [{ variantId: v.variantId, qty: 20 }] });
    let view = (await getCartView(guest(token)))!;
    // 45 together: list price, nudge toward 50 on both lines.
    expect(view.lines.map((l) => [l.kind, l.unitPaise, l.nudge?.qtyToGo])).toEqual([
      ['package', 49_000, 5],
      ['product', 49_000, 5],
    ]);
    await replacePackage(guest(token), { packageId: 'plan-a', lines: [{ variantId: v.variantId, qty: 30 }] });
    view = (await getCartView(guest(token)))!;
    // 55 together: both lines at the 50 tier, nudging toward 100, and the summary shows the tier savings.
    expect(view.lines.map((l) => [l.kind, l.unitPaise, l.bulkReached, l.nudge])).toEqual([
      ['package', 35_500, true, { minQty: 100, qtyToGo: 45, unitPaise: 34_000 }],
      ['product', 35_500, true, { minQty: 100, qtyToGo: 45, unitPaise: 34_000 }],
    ]);
    expect(view.totals).toMatchObject({ subtotalPaise: 55 * 49_000, tierSavingsPaise: 55 * (49_000 - 35_500), totalPaise: 55 * 35_500 });
  });

  it('replacePackage swaps the package, keeps extra lines, skips unpurchasable plants, and an empty list removes it', async () => {
    const a = await makeVariant(t, { listPaise: 10_000 });
    const b = await makeVariant(t, { listPaise: 20_000 });
    const off = await makeVariant(t, { listPaise: 20_000, purchasable: false });
    const token = await newCart(a.variantId, 2);
    await replacePackage(guest(token), { packageId: 'p1', landSqft: 43_560, lines: [{ variantId: a.variantId, qty: 5 }, { variantId: b.variantId, qty: 3 }] });
    const swap = await replacePackage(guest(token), { packageId: 'p2', landSqft: 21_780, lines: [{ variantId: b.variantId, qty: 4 }, { variantId: b.variantId, qty: 1 }, { variantId: off.variantId, qty: 9 }] });
    expect(swap.result).toEqual({ lines: 1, skipped: [off.variantId] });
    let view = (await getCartView(guest(token)))!;
    expect(view.packageId).toBe('p2');
    expect(view.landSqft).toBe(21_780);
    expect(view.lines.map((l) => [l.kind, l.variantId, l.qty])).toEqual([
      ['package', b.variantId, 5],
      ['product', a.variantId, 2],
    ]);
    await replacePackage(guest(token), { packageId: 'p2', lines: [] });
    view = (await getCartView(guest(token)))!;
    expect(view.packageId).toBeNull();
    expect(view.lines.map((l) => l.kind)).toEqual(['product']);
    await expect(replacePackage(guest(token), { packageId: 'p3', lines: [{ variantId: newId(), qty: 1 }] })).rejects.toMatchObject({ code: 'unknown_variant' });
  });

  it('suggests inputs when plants are in the cart and no inputs yet', async () => {
    const plant = await makeVariant(t, { listPaise: 10_000 });
    const input = await makeVariant(t, { listPaise: 50_000, kind: 'input', gstPct: 5 });
    const token = await newCart(plant.variantId, 1);
    expect((await getCartView(guest(token)))!.suggestInputs).toBe(true);
    await addLine(guest(token), { variantId: input.variantId, qty: 1 });
    expect((await getCartView(guest(token)))!.suggestInputs).toBe(false);
  });
});

describe('merge on sign-in', () => {
  it('merges the guest cart into the customer cart on the first read after sign-in', async () => {
    const a = await makeVariant(t, { listPaise: 10_000 });
    const b = await makeVariant(t, { listPaise: 20_000 });
    const c = await makeVariant(t, { listPaise: 30_000 });
    const customerId = newId();
    const me = (token: string | null): CartContext => ({ token, customerId, now: TEST_NOW });
    // Saved customer cart from another device: 3 x A, package with C.
    const saved = await addLine(me(null), { variantId: a.variantId, qty: 3 });
    expect(saved.issuedToken).not.toBeNull();
    await replacePackage(me(null), { packageId: 'old-plan', lines: [{ variantId: c.variantId, qty: 10 }] });
    // Guest on this device: 2 x A, 1 x B, a newer package with B.
    const token = await newCart(a.variantId, 2);
    await addLine(guest(token), { variantId: b.variantId, qty: 1 });
    await replacePackage(guest(token), { packageId: 'new-plan', lines: [{ variantId: b.variantId, qty: 6 }] });
    const guestCart = (await findCart(guest(token)))!;

    const view = (await getCartView(me(token)))!;
    expect(view.cartId).toBe(saved.cartId);
    expect(view.packageId).toBe('new-plan');
    expect(view.lines.map((l) => [l.kind, l.variantId, l.qty]).sort()).toEqual(
      [
        ['package', b.variantId, 6],
        ['product', a.variantId, 5],
        ['product', b.variantId, 1],
      ].sort(),
    );
    const [closed] = await t.db.select().from(cartCart).where(eq(cartCart.id, guestCart.id));
    expect(closed).toMatchObject({ status: 'merged', mergedIntoId: saved.cartId });
    // After sign-out the device's cookie no longer opens anything: guests never see a customer's cart.
    expect(await findCart(guest(token))).toBeNull();
  });

  it('claims the guest cart when the customer has none, and keeps it on later reads', async () => {
    const a = await makeVariant(t, { listPaise: 10_000 });
    const customerId = newId();
    const token = await newCart(a.variantId, 4);
    const first = (await findCart({ token, customerId }))!;
    expect(first.customerId).toBe(customerId);
    expect((await findCart({ token: null, customerId }))!.id).toBe(first.id);
    expect(await findCart(guest(token))).toBeNull();
  });
});

describe('totals preview', () => {
  it('equals the core.computeTotals fixture (tier, automatic promo, coupon, packing, transport, GST)', async () => {
    // packages/core/test/money-totals.test.ts `base`: 50 saplings at the bulk tier (0%), 2 compost (5%), 1 bio-pesticide (18%).
    const plant = await makeVariant(t, { listPaise: 49_000, tiers: [{ minQty: 50, unitPaise: 35_500 }], weightKg: 2 });
    const compost = await makeVariant(t, { listPaise: 50_000, kind: 'input', gstPct: 5, weightKg: 50 });
    const bio = await makeVariant(t, { listPaise: 30_000, kind: 'input', gstPct: 18, weightKg: 1 });
    const { port } = fakeDiscounts({
      promos: [{ id: 'compost-10', productId: compost.productId, amount: 10_000, stackable: true }],
      coupons: { SAVE500: { productId: plant.productId, amount: 50_000 } },
    });
    const shipping = fakeShippingQuote();
    const methods = await shipping.quoteMethods({ lines: [], totalWeightKg: 201, address: null });
    const local = methods.find((m) => m.methodId === 'local')!;
    // The fixture charges: packing 200, transport 1,500. The fake quotes `local` at that weight; pin the fixture values.
    bind({ discounts: port, services: { shipping: { ...shipping, quoteMethods: async () => [{ ...local, packingPaise: P(20_000), pricePaise: P(150_000) }] } } });

    const token = await newCart(plant.variantId, 50);
    await addLine(guest(token), { variantId: compost.variantId, qty: 2 });
    await addLine(guest(token), { variantId: bio.variantId, qty: 1 });
    expect(await applyCoupon(guest(token), 'save500')).toMatchObject({ ok: true, code: 'SAVE500' });
    await setDeliveryMethod(guest(token), 'local');

    const view = (await getCartView(guest(token)))!;
    const t1 = view.totals!;
    expect(t1.subtotalPaise).toBe(2_580_000);
    expect(t1.tierSavingsPaise).toBe(675_000);
    expect(t1.promoDiscountPaise).toBe(10_000);
    expect(t1.couponDiscountPaise).toBe(50_000);
    expect(t1.totalPaise).toBe(2_015_000);
    expect(t1.totalWeightKg).toBe(201);
    const byVariant = Object.fromEntries(view.lines.map((l) => [l.variantId, l.lineId]));
    const line = (id: string) => t1.lines.find((l) => l.lineId === byVariant[id])!;
    expect([plant, compost, bio].map((v) => [line(v.variantId).unitPaise, line(v.variantId).discountPaise, line(v.variantId).lineTotalPaise, line(v.variantId).taxPaise])).toEqual([
      [35_500, 50_000, 1_725_000, 0],
      [50_000, 10_000, 90_000, 4_286],
      [30_000, 0, 30_000, 4_576],
    ]);
    expect(t1.appliedDiscounts.map((d) => [d.id, d.amountPaise])).toEqual([
      ['compost-10', 10_000],
      ['SAVE500', 50_000],
    ]);
    expect(view.coupon).toEqual({ code: 'SAVE500', applied: true, reason: null });

    // No second pipeline: the preview is exactly computeTotals over the cart's own input.
    const discount = (id: string, kind: 'automatic' | 'coupon', stackable: boolean, lineId: string, amount: number): AppliedDiscountInput => ({ id, kind, label: id, stackable, allocations: [{ lineId, amountPaise: P(amount) }] });
    const input: TotalsInput = {
      lines: [
        { lineId: byVariant[plant.variantId]!, productId: plant.productId, variantId: plant.variantId, qty: 50, listUnitPaise: P(49_000), tierUnitPaise: P(35_500), gstRatePct: 0, weightKg: 2 },
        { lineId: byVariant[compost.variantId]!, productId: compost.productId, variantId: compost.variantId, qty: 2, listUnitPaise: P(50_000), tierUnitPaise: P(50_000), gstRatePct: 5, weightKg: 50 },
        { lineId: byVariant[bio.variantId]!, productId: bio.productId, variantId: bio.variantId, qty: 1, listUnitPaise: P(30_000), tierUnitPaise: P(30_000), gstRatePct: 18, weightKg: 1 },
      ],
      automaticPromos: [discount('compost-10', 'automatic', true, byVariant[compost.variantId]!, 10_000)],
      coupon: discount('SAVE500', 'coupon', false, byVariant[plant.variantId]!, 50_000),
      packingPaise: P(20_000),
      transportPaise: P(150_000),
      interState: false,
    };
    const expected = computeTotals(input);
    expect({ ...t1, lines: [...t1.lines].sort((a, b) => a.lineId.localeCompare(b.lineId)) }).toEqual({ ...expected, lines: [...expected.lines].sort((a, b) => a.lineId.localeCompare(b.lineId)) });
  });

  it('re-checks a stored coupon on every view without spending the typing limit, and drops it when it stops applying', async () => {
    const plant = await makeVariant(t, { listPaise: 10_000 });
    const other = await makeVariant(t, { listPaise: 10_000 });
    const { port, calls } = fakeDiscounts({ coupons: { ONLYPLANT: { productId: plant.productId, amount: 1_000 } } });
    bind({ discounts: port });
    const token = await newCart(plant.variantId, 1);
    expect(await applyCoupon(guest(token), 'nope')).toEqual({ ok: false, reason: 'invalid' });
    expect((await getCartView(guest(token)))!.coupon).toBeNull();
    expect(await applyCoupon(guest(token), 'onlyplant')).toMatchObject({ ok: true });
    await getCartView(guest(token));
    await getCartView(guest(token));
    expect(calls).toEqual({ apply: 2, evaluate: 2 });
    await addLine(guest(token), { variantId: other.variantId, qty: 1 });
    const line = (await getCartView(guest(token)))!.lines.find((l) => l.variantId === plant.variantId)!;
    await removeLine(guest(token), line.lineId);
    const view = (await getCartView(guest(token)))!;
    expect(view.coupon).toEqual({ code: 'ONLYPLANT', applied: false, reason: 'no_matching_items' });
    expect(view.totals!.couponDiscountPaise).toBe(0);
    await storeCoupon(guest(token), null);
    expect((await getCartView(guest(token)))!.coupon).toBeNull();
  });

  it('offers delivery methods from the shipping service and adds the chosen one to the totals', async () => {
    const plant = await makeVariant(t, { listPaise: 10_000, weightKg: 100 });
    bind({ services: { shipping: fakeShippingQuote() } });
    const token = await newCart(plant.variantId, 5);
    let view = (await getCartView(guest(token)))!;
    expect(view.methods.map((m) => [m.methodId, m.available])).toEqual([
      ['pickup', true],
      ['local', true],
      ['outstation', false],
    ]);
    expect(view.selectedMethodId).toBeNull();
    expect(view.totals!.transportPaise).toBe(0);
    await setDeliveryMethod(guest(token), 'local');
    view = (await getCartView(guest(token)))!;
    expect(view.selectedMethodId).toBe('local');
    expect(view.totals!.transportPaise).toBe(150_000); // small pickup, 500 kg
    expect(view.totals!.totalPaise).toBe(50_000 + 150_000);
    // An unavailable method is never selected.
    await setDeliveryMethod(guest(token), 'outstation');
    expect((await getCartView(guest(token)))!.selectedMethodId).toBeNull();
  });

  it('shows stock notes from the inventory service and leaves unpriced lines out of the totals', async () => {
    const out = await makeVariant(t, { listPaise: 10_000 });
    const ok = await makeVariant(t, { listPaise: 20_000 });
    const unpriced = await makeVariant(t, { listPaise: 0, priced: false });
    bind({ services: { inventory: fakeInventory({ [out.variantId]: 'out_of_stock' }) } });
    const token = await newCart(ok.variantId, 2);
    await addLine(guest(token), { variantId: out.variantId, qty: 1 });
    await addLine(guest(token), { variantId: unpriced.variantId, qty: 1 });
    const view = (await getCartView(guest(token)))!;
    const by = Object.fromEntries(view.lines.map((l) => [l.variantId, l]));
    expect(by[out.variantId]!.stock).toEqual({ note: 'out_of_stock', available: 0 });
    expect(by[unpriced.variantId]!.available).toBe(false);
    expect(view.totals!.lines).toHaveLength(2);
    expect(view.totals!.totalPaise).toBe(2 * 20_000 + 10_000);
  });
});

describe('cart.updated', () => {
  it('is emitted with the change, at most once a minute per cart', async () => {
    const v = await makeVariant(t, { listPaise: 10_000 });
    const before = (await outboxEvents(t, 'cart.updated')).length;
    const at = (min: number) => new Date(TEST_NOW.getTime() + min * 60_000);
    const first = await addLine({ token: null, customerId: null, now: at(0) }, { variantId: v.variantId, qty: 1 });
    const token = first.issuedToken!;
    await addLine({ token, customerId: null, now: at(0.2) }, { variantId: v.variantId, qty: 1 });
    await addLine({ token, customerId: null, now: at(0.4) }, { variantId: v.variantId, qty: 1 });
    await addLine({ token, customerId: null, now: at(2) }, { variantId: v.variantId, qty: 1 });
    const events = (await outboxEvents(t, 'cart.updated')).slice(before);
    expect(events.map((e) => e.payload)).toEqual([{ cartId: first.cartId }, { cartId: first.cartId }]);
  });
});
