import type { AppliedDiscountInput, ShippingMethodQuote, TotalsBreakdown } from '@ecomkit/core/contracts';
import { getViewer } from '@ecomkit/core/auth-context';
import { db, withTx, type DbOrTx, type Tx } from '@ecomkit/core/db';
import { emit } from '@ecomkit/core/events';
import { hashIp } from '@ecomkit/core/http';
import { asPaise } from '@ecomkit/core/money';
import { getSettings } from '@ecomkit/core/settings';
import { computeTotals } from '@ecomkit/core/totals';
import { listMyAddresses, recordConsent } from '@ecomkit/customers/server';
import { eq, sql } from 'drizzle-orm';
import {
  advanceFor,
  CONSENT_VERSION,
  contactInputSchema,
  paymentChoices,
  PICKUP_ONLY,
  placeOrderSchema,
  quoteInputSchema,
  reserveLines,
  totalsInput,
  type ContactInput,
  type PaymentChoice,
  type PlaceOrderInput,
  type QuoteInput,
} from '../domain';
import { checkoutMessages } from '../messages';
import { checkoutSession } from '../schema';
import { checkoutSettings, getCheckoutPorts, type CheckoutCart, type CheckoutOrderInput, type CouponCheck } from './ports';

export type CheckoutSessionRow = typeof checkoutSession.$inferSelect;
export interface StoredContact {
  name: string | null;
  phone: string | null;
  email: string | null;
  marketingConsent: boolean;
}
interface StoredDiscounts {
  promos: AppliedDiscountInput[];
  coupon: { ruleId: string; codeId: string; discount: AppliedDiscountInput } | null;
  couponRejected: string | null;
}
interface StoredQuote {
  discounts: StoredDiscounts;
  totals: TotalsBreakdown;
  methodId: string | null;
}

export type CheckoutFailure =
  | 'cart_empty'
  | 'unavailable'
  | 'address_required'
  | 'method_unavailable'
  | 'slot_unavailable'
  | 'payment_choice'
  | 'price_changed'
  | 'out_of_stock'
  | 'discount_unavailable'
  | 'already_placed';

export class CheckoutError extends Error {
  constructor(
    readonly code: CheckoutFailure,
    readonly shortages: readonly { variantId: string; requested: number; available: number }[] = [],
  ) {
    super(code);
    this.name = 'CheckoutError';
  }
}

export interface QuoteView {
  sessionId: string;
  methods: ShippingMethodQuote[];
  method: ShippingMethodQuote | null;
  totals: TotalsBreakdown;
  paymentChoices: PaymentChoice[];
  advancePaise: number;
  couponRejected: string | null;
}

export type PlaceOrderResult =
  | { ok: true; orderId: string; number: string; next: string; replay: boolean }
  | { ok: false; formError: CheckoutFailure; shortages?: CheckoutError['shortages']; quote?: QuoteView };

const DAY_MS = 86_400_000;

async function currentCart(): Promise<CheckoutCart> {
  const cart = await getCheckoutPorts().cart?.current();
  if (!cart || cart.lines.length === 0) throw new CheckoutError('cart_empty');
  return cart;
}

/** The open checkout for a cart (one per cart). Creating it emits `checkout.started` in the same transaction. */
async function ensureSession(tx: Tx, cart: CheckoutCart, now: Date): Promise<CheckoutSessionRow> {
  const s = await getSettings(checkoutSettings, tx);
  const [created] = await tx
    .insert(checkoutSession)
    .values({ cartId: cart.id, customerId: cart.customerId, expiresAt: new Date(now.getTime() + s.sessionDays * DAY_MS) })
    .onConflictDoNothing({ target: checkoutSession.cartId })
    .returning();
  if (created) {
    await emit('checkout.started', { checkoutSessionId: created.id, cartId: cart.id }, { tx });
    return created;
  }
  const [row] = await tx.select().from(checkoutSession).where(eq(checkoutSession.cartId, cart.id)).for('update');
  return row!;
}

const contactOf = (s: CheckoutSessionRow): StoredContact => ({ name: null, phone: null, email: null, marketingConsent: false, ...((s.contact as Partial<StoredContact> | null) ?? {}) });

/**
 * Contact autosave (on blur, debounced in the form): stores name, phone and email on the checkout session so an
 * abandoned checkout has someone to message, and emits `checkout.contact_saved` when the phone or email changed.
 * Never writes consent (that happens on an explicit tick or at place-order).
 */
export async function saveContact(raw: ContactInput, options: { now?: Date } = {}): Promise<{ sessionId: string; changed: boolean }> {
  const input = contactInputSchema.parse(raw);
  const cart = await currentCart();
  return withTx(async (tx) => {
    const session = await ensureSession(tx, cart, options.now ?? new Date());
    const prev = contactOf(session);
    const next: StoredContact = { name: input.name ?? null, phone: input.phone ?? null, email: input.email ?? null, marketingConsent: prev.marketingConsent };
    const reachable = next.phone !== prev.phone || next.email !== prev.email;
    if (!reachable && next.name === prev.name) return { sessionId: session.id, changed: false };
    await tx.update(checkoutSession).set({ contact: next, updatedAt: sql`now()` }).where(eq(checkoutSession.id, session.id));
    if (reachable && (next.phone || next.email)) {
      await emit('checkout.contact_saved', { checkoutSessionId: session.id, cartId: cart.id, phone: next.phone, email: next.email }, { tx });
    }
    return { sessionId: session.id, changed: true };
  });
}

async function writeConsent(
  tx: Tx,
  purpose: 'marketing' | 'order_updates',
  granted: boolean,
  who: { customerId: string | null; phone: string | null; email: string | null },
  meta: { ip?: string | null; userAgent?: string | null },
) {
  const text = purpose === 'marketing' ? checkoutMessages.contact.marketingConsent : checkoutMessages.contact.orderUpdatesConsent;
  await recordConsent(
    {
      subject: { userId: who.customerId, phone: who.phone, email: who.email },
      purpose,
      granted,
      textShown: `${CONSENT_VERSION}: ${text}`,
      source: 'checkout',
      ipHash: hashIp(meta.ip ?? null),
      userAgent: meta.userAgent?.slice(0, 400) ?? null,
    },
    { tx },
  );
}

/** The marketing checkbox, ticked or unticked by the buyer: records the grant or revocation with the exact text. */
export async function setMarketingConsent(granted: boolean, meta: { ip?: string | null; userAgent?: string | null; now?: Date } = {}): Promise<{ recorded: boolean }> {
  const cart = await currentCart();
  const viewer = await getViewer();
  return withTx(async (tx) => {
    const session = await ensureSession(tx, cart, meta.now ?? new Date());
    const c = contactOf(session);
    if (c.marketingConsent === granted) return { recorded: false };
    if (!c.phone && !c.email) return { recorded: false };
    await writeConsent(tx, 'marketing', granted, { customerId: viewer.kind === 'customer' ? viewer.customerId : null, phone: c.phone, email: c.email }, meta);
    await tx.update(checkoutSession).set({ contact: { ...c, marketingConsent: granted }, updatedAt: sql`now()` }).where(eq(checkoutSession.id, session.id));
    return { recorded: true };
  });
}

async function loadDiscounts(cart: CheckoutCart, who: { customerId: string | null; phone: string | null }): Promise<StoredDiscounts> {
  const d = getCheckoutPorts().discounts;
  if (!d) return { promos: [], coupon: null, couponRejected: null };
  const promos = await d.promos(cart.lines, { customerId: who.customerId });
  let coupon: StoredDiscounts['coupon'] = null;
  let couponRejected: string | null = null;
  if (cart.couponCode) {
    const res: CouponCheck = await d.coupon(cart.couponCode, cart.lines, { subject: `checkout:${cart.id}`, phone: who.phone, customerId: who.customerId });
    if (res.ok && res.discount && res.ruleId && res.codeId) coupon = { ruleId: res.ruleId, codeId: res.codeId, discount: res.discount };
    else couponRejected = res.reason ?? 'invalid';
  }
  return { promos, coupon, couponRejected };
}

type QuoteAddress = { pincode?: string | null; districtSlug?: string | null; stateCode?: string | null } | null | undefined;

async function priceCart(cart: CheckoutCart, address: QuoteAddress, methodId: string | null | undefined, discounts: StoredDiscounts, conn: DbOrTx = db) {
  const { shipping: shippingPort, orders, payments } = getCheckoutPorts();
  const shipping = shippingPort ? await shippingPort() : null;
  const totalWeightKg = cart.lines.reduce((s, l) => s + l.qty * l.weightKg, 0);
  const methods = shipping
    ? await shipping.quoteMethods({
        lines: cart.lines.map((l) => ({ variantId: l.variantId, qty: l.qty, weightKg: l.weightKg, packingFeePaise: asPaise(l.packingFeePaise) })),
        totalWeightKg,
        address: address ? { pincode: address.pincode ?? null, districtSlug: address.districtSlug ?? null, stateCode: address.stateCode ?? null } : null,
      })
    : [PICKUP_ONLY];
  const method = methods.find((m) => m.methodId === methodId && m.available) ?? methods.find((m) => m.available) ?? null;
  const seller = (await orders?.sellerStateCode()) ?? '';
  const interState = method?.kind !== 'pickup' && !!address?.stateCode && !!seller && address.stateCode !== seller;
  const settings = await getSettings(checkoutSettings, conn);
  const totals = computeTotals(
    totalsInput({ lines: cart.lines, promos: discounts.promos, coupon: discounts.coupon?.discount ?? null, method, chargesGstRatePct: settings.chargesGstRatePct, interState }),
  );
  const cfg = payments ? await payments.config() : { codMode: 'online_only' as const, advancePct: 100, attemptExpiryMinutes: 15 };
  return { methods, method, totals, cfg, choices: paymentChoices(cfg.codMode, method?.kind ?? null), advancePaise: advanceFor(totals.totalPaise, cfg.advancePct) };
}

/**
 * Server-side quote through `core.computeTotals` for the current cart, the (partial) address and the chosen
 * delivery method. The coupon is validated on the first quote and at place-order only; re-quotes for an address
 * or method change reuse the stored result, so typing an address never burns coupon attempts.
 */
export async function quote(raw: QuoteInput = {}, options: { now?: Date; refreshDiscounts?: boolean } = {}): Promise<QuoteView> {
  const input = quoteInputSchema.parse(raw);
  const cart = await currentCart();
  const viewer = await getViewer();
  return withTx(async (tx) => {
    const session = await ensureSession(tx, cart, options.now ?? new Date());
    const stored = session.quote as StoredQuote | null;
    const c = contactOf(session);
    const discounts =
      stored?.discounts && !options.refreshDiscounts ? stored.discounts : await loadDiscounts(cart, { customerId: viewer.kind === 'customer' ? viewer.customerId : null, phone: c.phone });
    const address = input.address ?? (session.addressDraft as QuoteAddress) ?? null;
    const p = await priceCart(cart, address, input.methodId ?? session.methodId, discounts, tx);
    const next: StoredQuote = { discounts, totals: p.totals, methodId: p.method?.methodId ?? null };
    await tx
      .update(checkoutSession)
      .set({ quote: next, methodId: next.methodId, ...(input.address ? { addressDraft: input.address } : {}), updatedAt: sql`now()` })
      .where(eq(checkoutSession.id, session.id));
    return { sessionId: session.id, methods: p.methods, method: p.method, totals: p.totals, paymentChoices: p.choices, advancePaise: p.advancePaise, couponRejected: discounts.couponRejected };
  });
}

function nextFor(orderId: string, token: string, pending: boolean): string {
  return pending ? `/checkout/${orderId}/pay?t=${encodeURIComponent(token)}` : `/order/${token}`;
}

/** Hands the buyer to the payment provider; when that fails the pay page offers a retry (the order stays pending). */
async function startPayment(order: { id: string; number: string; amountPaise: number; contact: { name: string | null; phone: string | null; email: string | null } }, token: string): Promise<string> {
  const payments = getCheckoutPorts().payments;
  try {
    const res = await payments!.start({ orderId: order.id, orderNumber: order.number, amountPaise: asPaise(order.amountPaise), customer: order.contact, returnPath: `/order/${token}` });
    return res.redirectUrl ?? `/order/${token}`;
  } catch {
    return nextFor(order.id, token, true);
  }
}

async function replayResult(orderId: string): Promise<PlaceOrderResult> {
  const orders = getCheckoutPorts().orders!;
  const token = orders.guestToken(orderId);
  const summary = await orders.forBuyer(orderId, token);
  return { ok: true, replay: true, orderId, number: summary?.number ?? '', next: nextFor(orderId, token, summary?.status === 'pending_payment') };
}

/**
 * Idempotent place-order. One transaction: lock the checkout session (a replayed key returns the order it
 * already made), reprice the cart server-side, hold stock with TTL = payment attempt expiry (A27), create the
 * order with price snapshots and a `core_sequence` number (`order.placed` in the same transaction), redeem the
 * discounts, record consent, convert the cart. Any failure rolls everything back and the form stays filled.
 */
export async function placeOrder(raw: PlaceOrderInput, meta: { ip?: string | null; userAgent?: string | null; now?: Date } = {}): Promise<PlaceOrderResult> {
  const input = placeOrderSchema.parse(raw);
  const ports = getCheckoutPorts();
  if (!ports.cart || !ports.orders || !ports.payments) return { ok: false, formError: 'unavailable' };
  const { orders } = ports;
  const now = meta.now ?? new Date();
  const viewer = await getViewer();
  const customerId = viewer.kind === 'customer' ? viewer.customerId : null;

  // A replayed submit (double click, retry after a timeout) finds its order by key, even after the cart converted.
  const [byKey] = await db.select().from(checkoutSession).where(eq(checkoutSession.idempotencyKey, input.idempotencyKey));
  if (byKey?.orderId) {
    // A signed-in buyer's order never replays to anyone else (the result carries the order capability).
    if (byKey.customerId && byKey.customerId !== customerId) return { ok: false, formError: 'cart_empty' };
    return replayResult(byKey.orderId);
  }

  let cart: CheckoutCart;
  try {
    cart = await currentCart();
  } catch (err) {
    if (err instanceof CheckoutError) return { ok: false, formError: err.code };
    throw err;
  }

  try {
    const placed = await withTx(async (tx) => {
      const session = await ensureSession(tx, cart, now);
      if (session.orderId) return { replay: true as const, orderId: session.orderId };

      const discounts = await loadDiscounts(cart, { customerId, phone: input.phone });
      const p = await priceCart(cart, input.address, input.methodId, discounts, tx);
      const method = p.method;
      if (!method || method.methodId !== input.methodId) throw new CheckoutError('method_unavailable');
      if (method.kind !== 'pickup' && !input.address) throw new CheckoutError('address_required');
      let slotDate = input.slotDate ?? null;
      if (method.kind === 'local_slot' && method.slots.length) {
        slotDate ??= method.slots.find((s) => s.remaining > 0)?.date ?? null;
        if (!method.slots.some((s) => s.date === slotDate && s.remaining > 0)) throw new CheckoutError('slot_unavailable');
      }
      if (!p.choices.includes(input.paymentChoice)) throw new CheckoutError('payment_choice');
      if (input.expectedTotalPaise != null && input.expectedTotalPaise !== p.totals.totalPaise) throw new CheckoutError('price_changed');

      const inventory = ports.inventory ? await ports.inventory() : null;
      let reservationId: string | null = null;
      if (inventory) {
        const held = await inventory.reserve(reserveLines(cart.lines), { ttlSec: p.cfg.attemptExpiryMinutes * 60, reference: `checkout:${session.id}`, tx });
        if (!held.ok) throw new CheckoutError('out_of_stock', held.shortages);
        reservationId = held.reservation.reservationId;
      }

      const t = p.totals;
      const payAtNursery = input.paymentChoice === 'pay_at_nursery';
      const contact = { name: input.name, phone: input.phone, email: input.email ?? null };
      const order: CheckoutOrderInput = {
        customerId,
        contact,
        shippingAddress: input.address ? { ...input.address } : null,
        billing: input.gstin && input.legalName ? { gstin: input.gstin, legalName: input.legalName } : null,
        delivery: {
          methodId: method.methodId,
          kind: method.kind,
          label: checkoutMessages.delivery.kinds[method.kind],
          slotDate,
          vehicle: method.vehicle?.label ?? null,
          km: method.distanceKm,
          promise: method.promise,
        },
        lines: cart.lines.map((l) => {
          const tl = t.lines.find((x) => x.lineId === l.lineId)!;
          return {
            variantId: l.variantId,
            productId: l.productId,
            snapshot: { name: l.name, sku: l.sku, hsn: l.hsn, gstRatePct: l.gstRatePct, sizeClass: l.sizeClass, weightKg: l.weightKg },
            qty: l.qty,
            listUnitPaise: l.listUnitPaise,
            unitPaise: tl.unitPaise,
            tierApplied: l.tierUnitPaise < l.listUnitPaise,
            discountPaise: tl.discountPaise,
            taxPaise: tl.taxPaise,
            lineTotalPaise: tl.lineTotalPaise,
            kind: l.kind,
            origin: l.origin,
          };
        }),
        totals: {
          subtotalPaise: t.subtotalPaise,
          tierSavingsPaise: t.tierSavingsPaise,
          promoPaise: t.promoDiscountPaise,
          couponPaise: t.couponDiscountPaise,
          packingPaise: t.packingPaise,
          shippingPaise: t.transportPaise,
          taxPaise: t.tax.totalTaxPaise,
          totalPaise: t.totalPaise,
          weightKg: t.totalWeightKg,
          chargesGstRatePct: (await getSettings(checkoutSettings, tx)).chargesGstRatePct,
          breakdown: t as unknown as Record<string, unknown>,
        },
        source: 'web',
        paymentMode: input.paymentChoice,
        advancePaise: input.paymentChoice === 'partial_advance' ? p.advancePaise : t.totalPaise,
        initialStatus: payAtNursery ? 'confirmed' : 'pending_payment',
        reservationId,
        attribution: ports.attribution ? await ports.attribution() : null,
        isTest: false,
      };
      const created = await orders.createOrder(order, { tx });

      const uses = t.appliedDiscounts.map((d) => ({ ruleId: d.id, codeId: d.kind === 'coupon' ? (discounts.coupon?.codeId ?? null) : null, amountPaise: d.amountPaise }));
      if (uses.length) {
        try {
          await ports.discounts!.redeem({ orderId: created.id, customerId, phone: input.phone, discounts: uses }, { tx });
        } catch (err) {
          if (err instanceof Error && err.name === 'RedemptionError') throw new CheckoutError('discount_unavailable');
          throw err;
        }
      }

      const prev = contactOf(session);
      await writeConsent(tx, 'order_updates', true, { customerId, ...contact }, meta);
      if (input.marketingConsent && !prev.marketingConsent) await writeConsent(tx, 'marketing', true, { customerId, ...contact }, meta);
      if (payAtNursery && reservationId) await inventory!.commit(reservationId, { tx });

      await tx
        .update(checkoutSession)
        .set({
          orderId: created.id,
          idempotencyKey: input.idempotencyKey,
          customerId,
          step: 'placed',
          contact: { ...contact, marketingConsent: input.marketingConsent || prev.marketingConsent },
          addressDraft: input.address ?? null,
          methodId: method.methodId,
          slotDate,
          quote: { discounts, totals: t, methodId: method.methodId } satisfies StoredQuote,
          updatedAt: sql`now()`,
        })
        .where(eq(checkoutSession.id, session.id));
      await ports.cart!.markConverted(cart.id, created.id, { tx });
      return {
        replay: false as const,
        orderId: created.id,
        number: created.number,
        token: created.guestToken,
        pending: !payAtNursery,
        amountPaise: order.advancePaise,
        contact,
      };
    });

    if (placed.replay) return replayResult(placed.orderId);
    const next = placed.pending ? await startPayment({ id: placed.orderId, number: placed.number, amountPaise: placed.amountPaise, contact: placed.contact }, placed.token) : `/order/${placed.token}`;
    return { ok: true, replay: false, orderId: placed.orderId, number: placed.number, next };
  } catch (err) {
    if (err instanceof CheckoutError) return { ok: false, formError: err.code, ...(err.shortages.length ? { shortages: err.shortages } : {}) };
    throw err;
  }
}

/** Pay page: the order for its buyer and, when still pending, a fresh payment start. */
export async function retryPayment(orderId: string, token: string | null): Promise<string | null> {
  const { orders, payments } = getCheckoutPorts();
  if (!orders || !payments) return null;
  const order = await orders.forBuyer(orderId, token);
  if (!order) return null;
  const guest = orders.guestToken(order.id);
  if (order.status !== 'pending_payment') return `/order/${guest}`;
  const amountPaise = (order.advancePaise || order.totalPaise) - order.paidPaise;
  return startPayment({ id: order.id, number: order.number, amountPaise, contact: order.contact }, guest);
}

/** For flows (abandoned checkout): the saved contact of a checkout session, and whether it became an order. */
export async function checkoutContact(checkoutSessionId: string): Promise<{ cartId: string; contact: StoredContact; orderId: string | null } | null> {
  const [s] = /^[0-9a-f-]{36}$/i.test(checkoutSessionId) ? await db.select().from(checkoutSession).where(eq(checkoutSession.id, checkoutSessionId)) : [];
  return s ? { cartId: s.cartId, contact: contactOf(s), orderId: s.orderId } : null;
}

export interface CheckoutPageData {
  quote: QuoteView;
  lines: { lineId: string; name: string; qty: number }[];
  contact: StoredContact;
  address: Record<string, string | null> | null;
  states: { code: string; name: string }[];
  signedIn: boolean;
}

/**
 * Everything the checkout page renders: a fresh quote (coupon re-validated), the cart lines, the autosaved
 * contact and address, or the signed-in customer's default saved address. Throws CheckoutError('cart_empty').
 */
export async function openCheckout(): Promise<CheckoutPageData> {
  // The viewer read marks the render request-time first, so /checkout is never prerendered with a build-time cart.
  const viewer = await getViewer();
  const view = await quote({}, { refreshDiscounts: true });
  const cart = await currentCart();
  const [session] = await db.select().from(checkoutSession).where(eq(checkoutSession.id, view.sessionId));
  let contact = contactOf(session!);
  let address = (session!.addressDraft as Record<string, string | null> | null) ?? null;
  if (viewer.kind === 'customer') {
    contact = { ...contact, name: contact.name ?? viewer.name, phone: contact.phone ?? viewer.phone, email: contact.email ?? viewer.email };
    if (!address?.line1) {
      const saved = (await listMyAddresses()).find((a) => a.isDefault);
      if (saved) {
        address = {
          line1: saved.line1,
          line2: saved.line2,
          landmark: saved.landmark,
          villageTown: saved.villageTown,
          pincode: saved.pincode,
          district: saved.districtText,
          state: saved.state,
        };
      }
    }
  }
  const regions = getCheckoutPorts().regions;
  return {
    quote: view,
    lines: cart.lines.map((l) => ({ lineId: l.lineId, name: l.name, qty: l.qty })),
    contact,
    address,
    states: regions ? await regions.states() : [],
    signedIn: viewer.kind === 'customer',
  };
}
