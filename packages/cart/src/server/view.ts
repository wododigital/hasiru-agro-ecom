// The cart as shoppers see it: lines with product facts, tier prices, nudges, stock notes, discounts,
// delivery quotes and the totals from core.computeTotals (the only totals pipeline).
import type { AppliedDiscountInput, CartBlockLine, CartLineOrigin, ImageRef, Paise, PriceQuote, ShippingMethodQuote, StockInfo, TotalsBreakdown } from '@ecomkit/core/contracts';
import { formatINR } from '@ecomkit/core/money';
import { rateLimit } from '@ecomkit/core/rate-limit';
import { computeTotals } from '@ecomkit/core/totals';
import { priceLines } from '@ecomkit/pricing/server';
import { bulkNudge, lineWeightKg, needsInputsSuggestion, originSchema, toTotalsInput, type BulkNudge, type LineOrigin } from '../domain';
import type { CartMessages } from '../messages';
import type { CartRow } from '../schema';
import { cartLines, findCart, storeCoupon, type CartContext } from './cart';
import { cartRuntime, loadVariants, optionalService, type CouponOutcome, type DiscountCartInput } from './runtime';

export interface CartViewLine {
  lineId: string;
  kind: 'product' | 'package';
  variantId: string;
  productId: string | null;
  productKind: 'plant' | 'input' | null;
  name: string | null;
  nameKn: string | null;
  label: string | null;
  href: string | null;
  image: ImageRef | null;
  qty: number;
  weightKg: number;
  origin: LineOrigin | null;
  /** Price facts; null when the line is unavailable (unknown variant, not purchasable, no price). */
  listUnitPaise: Paise | null;
  unitPaise: Paise | null;
  lineTotalPaise: Paise | null;
  bulkReached: boolean;
  nudge: BulkNudge | null;
  available: boolean;
  stock: { note: 'out_of_stock' | 'short'; available: number } | null;
}

export interface CartView {
  cartId: string;
  /** Total quantity (the header count). */
  count: number;
  lines: CartViewLine[];
  packageId: string | null;
  landSqft: number | null;
  totals: TotalsBreakdown | null;
  coupon: { code: string; applied: boolean; reason: string | null } | null;
  /** False when no discounts module is bound (no coupon field). */
  couponsEnabled: boolean;
  methods: ShippingMethodQuote[];
  selectedMethodId: string | null;
  suggestInputs: boolean;
  /** cart-block contract lines (truck meter and other blocks). */
  blockLines: CartBlockLine[];
}

function parseOrigin(raw: unknown): LineOrigin | null {
  const r = originSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/** Lines with product facts, tier prices (cross-line summation) and stock, plus the discounts view of them. */
async function priceCart(cart: CartRow) {
  const rows = await cartLines(cart.id);
  const variants = await loadVariants(rows.map((r) => r.variantId));
  const sellable = rows.filter((r) => variants[r.variantId]?.purchasable);
  const [quotes, inventory] = await Promise.all([
    sellable.length ? priceLines(sellable.map((r) => ({ lineId: r.id, variantId: r.variantId, qty: r.qty }))) : Promise.resolve({} as Record<string, PriceQuote>),
    optionalService('inventory'),
  ]);
  const stocks: Record<string, StockInfo> = inventory && rows.length ? await inventory.getStocks([...new Set(rows.map((r) => r.variantId))]) : {};

  const lines: CartViewLine[] = rows.map((r) => {
    const v = variants[r.variantId];
    const origin = parseOrigin(r.origin);
    const q = quotes[r.id] ?? null;
    const s = stocks[r.variantId];
    return {
      lineId: r.id,
      kind: r.kind,
      variantId: r.variantId,
      productId: v?.productId ?? null,
      productKind: v?.kind ?? null,
      name: v?.name ?? null,
      nameKn: v?.nameKn ?? null,
      label: v?.label ?? null,
      href: v?.href ?? null,
      image: v?.image ?? null,
      qty: r.qty,
      weightKg: lineWeightKg(v?.weightKg, origin),
      origin,
      listUnitPaise: q?.listUnitPaise ?? null,
      unitPaise: q?.unitPaise ?? null,
      lineTotalPaise: q?.lineTotalPaise ?? null,
      bulkReached: !!q?.tier,
      nudge: bulkNudge(q),
      available: !!q,
      stock: !s ? null : s.availability === 'out_of_stock' ? { note: 'out_of_stock', available: 0 } : s.availability === 'in_stock' && s.available < r.qty ? { note: 'short', available: s.available } : null,
    };
  });
  const priced = lines.filter((l) => l.available);
  const discountCart: DiscountCartInput = {
    lines: priced.map((l) => {
      const v = variants[l.variantId]!;
      return { lineId: l.lineId, productId: v.productId, qty: l.qty, unitPaise: l.unitPaise!, collectionIds: v.collectionIds ?? [], tagIds: v.tagIds ?? [] };
    }),
    customer: null,
  };
  return { rows, lines, priced, quotes, discountCart };
}

/** Builds the full view of one cart (a few batched calls, never one per line). */
export async function loadCartView(cart: CartRow, options: { customerId?: string | null } = {}): Promise<CartView> {
  const rt = cartRuntime();
  const [{ rows, lines, priced, quotes, discountCart }, shipping] = await Promise.all([priceCart(cart), optionalService('shipping')]);
  const port = rt.discounts;
  let promos: AppliedDiscountInput[] = [];
  let coupon: CouponOutcome | null = null;
  if (port && priced.length) {
    [promos, coupon] = await Promise.all([
      port.promos(discountCart),
      cart.couponCode ? port.evaluateCoupon(cart.couponCode, discountCart, { customerId: options.customerId ?? cart.customerId }) : Promise.resolve(null),
    ]);
  }

  const totalWeightKg = priced.reduce((s, l) => s + l.weightKg * l.qty, 0);
  const district = shipping && priced.length ? await rt.readDistrict() : null;
  const methods =
    shipping && priced.length
      ? await shipping.quoteMethods({
          lines: priced.map((l) => ({ variantId: l.variantId, qty: l.qty, weightKg: l.weightKg, packingFeePaise: 0 as Paise })),
          totalWeightKg,
          address: district ? { pincode: null, districtSlug: district, stateCode: null } : null,
        })
      : [];
  const wanted = cart.deliveryMethodSnapshot?.methodId ?? null;
  const selected = methods.find((m) => m.methodId === wanted && m.available) ?? null;

  const totals = priced.length
    ? computeTotals(
        toTotalsInput(
          priced.map((l) => ({ lineId: l.lineId, qty: l.qty, weightKg: l.weightKg, quote: quotes[l.lineId] ?? null })),
          { promos, coupon: coupon?.ok ? coupon.discount : null },
          selected ? { packingPaise: selected.packingPaise, transportPaise: selected.pricePaise } : null,
        ),
      )
    : null;
  const couponRejected = coupon?.ok && totals?.rejectedDiscounts.some((d) => d.id === coupon.discount.id);

  return {
    cartId: cart.id,
    count: rows.reduce((s, r) => s + r.qty, 0),
    lines,
    packageId: cart.planId,
    landSqft: cart.landSqft,
    totals,
    coupon: cart.couponCode
      ? { code: cart.couponCode, applied: !!coupon?.ok && !couponRejected, reason: couponRejected ? 'not_stackable' : coupon && !coupon.ok ? coupon.reason : !port ? 'unavailable' : priced.length ? null : 'empty' }
      : null,
    couponsEnabled: !!port,
    methods,
    selectedMethodId: selected?.methodId ?? null,
    suggestInputs: needsInputsSuggestion(lines.map((l) => l.productKind)),
    blockLines: lines
      .filter((l) => l.productId)
      .map((l) => ({
        lineId: l.lineId,
        kind: l.kind,
        productId: l.productId!,
        variantId: l.variantId,
        qty: l.qty,
        weightKg: l.weightKg,
        packageId: l.kind === 'package' ? cart.planId : null,
        origin: l.origin as CartLineOrigin | null,
      })),
  };
}

/** The visitor's cart view, or null when they have no cart. */
export async function getCartView(ctx: CartContext): Promise<CartView | null> {
  const cart = await findCart(ctx);
  return cart ? loadCartView(cart, { customerId: ctx.customerId }) : null;
}

/** `cartTotals()` (public API): the totals preview of the visitor's cart. */
export async function cartTotals(ctx: CartContext): Promise<TotalsBreakdown | null> {
  return (await getCartView(ctx))?.totals ?? null;
}

/** Header count without the whole view. */
export async function cartCount(ctx: CartContext): Promise<number> {
  const cart = await findCart(ctx);
  return cart ? (await cartLines(cart.id)).reduce((s, l) => s + l.qty, 0) : 0;
}

/**
 * A code the shopper typed: checked by the discounts module against the current cart (rate-limited per cart)
 * and stored only when it applies.
 */
const COUPON_IP_LIMIT = { limit: 30, windowSec: 3600 };

export async function applyCoupon(ctx: CartContext, code: string): Promise<CouponOutcome> {
  const port = cartRuntime().discounts;
  if (!port) return { ok: false, reason: 'unavailable' };
  const cart = await findCart(ctx);
  if (!cart) return { ok: false, reason: 'empty' };
  const { priced, discountCart } = await priceCart(cart);
  if (!priced.length) return { ok: false, reason: 'empty' };
  // Per client IP as well as per cart: a fresh cart per attempt must not reset the guessing budget.
  const perIp = await rateLimit(`coupon-try:${ctx.createSubject ?? 'anon'}`, COUPON_IP_LIMIT);
  if (!perIp.ok) return { ok: false, reason: 'rate_limited' };
  const outcome = await port.applyCoupon(code, discountCart, { subject: `cart:${cart.id}`, customerId: ctx.customerId });
  if (outcome.ok) await storeCoupon(ctx, outcome.code);
  return outcome;
}

/** What the header drawer shows: already-formatted strings, so the client island needs no copy functions. */
export interface DrawerData {
  count: number;
  countLabel: string;
  lines: { lineId: string; name: string; detail: string | null; qty: number; total: string | null; href: string | null; image: ImageRef | null; available: boolean }[];
  total: string | null;
}

export function toDrawerData(view: CartView | null, m: CartMessages = cartRuntime().messages): DrawerData {
  if (!view) return { count: 0, countLabel: m.drawer.count(0), lines: [], total: null };
  return {
    count: view.count,
    countLabel: m.drawer.count(view.count),
    lines: view.lines.map((l) => ({
      lineId: l.lineId,
      name: l.name ?? '',
      detail: l.label,
      qty: l.qty,
      total: l.lineTotalPaise === null ? null : formatINR(l.lineTotalPaise),
      href: l.href,
      image: l.image,
      available: l.available,
    })),
    total: view.totals ? formatINR(view.totals.totalPaise) : null,
  };
}
