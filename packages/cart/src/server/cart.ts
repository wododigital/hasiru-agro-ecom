// Cart state: cookie resolution, merge on login, line mutations, package replacement, conversion, abandonment,
// restore links. No `server-only` here: the worker loads the abandon job under plain Node; ./index.ts adds the guard.
import { createHash, randomBytes } from 'node:crypto';
import type { EventPayloads } from '@ecomkit/core/contracts';
import { db, withTx, type DbOrTx, type Tx } from '@ecomkit/core/db';
import { emit } from '@ecomkit/core/events';
import { signInternal, verifyInternal } from '@ecomkit/core/http';
import { rateLimit } from '@ecomkit/core/rate-limit';
import { defineSettings, getSettings } from '@ecomkit/core/settings';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  addLineSchema,
  cartSettingsSchema,
  deltaSchema,
  MAX_LINE_QTY,
  MAX_LINES,
  replacePackageSchema,
  setQtySchema,
  UPDATED_EVENT_GAP_MS,
  type AddLineInput,
  type ReplacePackageInput,
} from '../domain';
import { cartCart, cartLine, type CartRow } from '../schema';
import { loadVariants } from './runtime';

export const cartSettings = defineSettings('cart', cartSettingsSchema);

export async function readCartSettings(conn?: DbOrTx) {
  try {
    return await getSettings(cartSettings, conn);
  } catch {
    return cartSettingsSchema.parse({});
  }
}

/** Who is asking: the cart cookie token (if any) and the signed-in customer (if any). */
export interface CartContext {
  token: string | null;
  customerId: string | null;
  now?: Date;
  /** Rate-limit subject for creating a new cart (hashed X-Real-IP). Null without a proxy-supplied IP (local dev): no limit. */
  createSubject?: string | null;
}

export type CartErrorCode = 'unknown_variant' | 'not_purchasable' | 'too_many_lines' | 'rate_limited';
export class CartError extends Error {
  constructor(readonly code: CartErrorCode) {
    super(`cart: ${code}`);
    this.name = 'CartError';
  }
}

const LIVE = ['active', 'abandoned'] as const;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const CART_CREATE_LIMIT = { limit: 30, windowSec: 3600 };

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('base64url');
const newToken = () => randomBytes(32).toString('base64url');
const validToken = (t: string | null | undefined): t is string => !!t && TOKEN_RE.test(t);

interface Resolved {
  cart: CartRow;
  /** A new cookie token when a cart was created or adopted; the caller writes the cookie. */
  issuedToken: string | null;
  /** Created or merged here: the caller's touch emits `cart.updated` regardless of the throttle. */
  changed: boolean;
}

async function cartByToken(tx: Tx, token: string | null): Promise<CartRow | null> {
  if (!validToken(token)) return null;
  const [row] = await tx
    .select()
    .from(cartCart)
    .where(and(eq(cartCart.cookieTokenHash, hashToken(token)), inArray(cartCart.status, LIVE)))
    .for('update');
  return row ?? null;
}

async function customerCart(tx: Tx, customerId: string): Promise<CartRow | null> {
  const [row] = await tx
    .select()
    .from(cartCart)
    .where(and(eq(cartCart.customerId, customerId), inArray(cartCart.status, LIVE)))
    .orderBy(desc(cartCart.lastActivityAt))
    .limit(1)
    .for('update');
  return row ?? null;
}

/**
 * Moves `source` into `target`: product lines add up (capped), a package in the source replaces the target's
 * package (the newer plan wins), the target keeps its coupon if it has one. The source is closed as `merged`.
 */
async function mergeInto(tx: Tx, target: CartRow, source: CartRow, now: Date): Promise<CartRow> {
  const lines = await tx.select().from(cartLine).where(eq(cartLine.cartId, source.id));
  const hasPackage = lines.some((l) => l.kind === 'package');
  if (hasPackage) await tx.delete(cartLine).where(and(eq(cartLine.cartId, target.id), eq(cartLine.kind, 'package')));
  if (lines.length) {
    await tx
      .insert(cartLine)
      .values(lines.map((l) => ({ cartId: target.id, variantId: l.variantId, qty: l.qty, kind: l.kind, origin: l.origin, addedAt: l.addedAt })))
      .onConflictDoUpdate({ target: [cartLine.cartId, cartLine.variantId, cartLine.kind], set: { qty: sql`least(${cartLine.qty} + excluded.qty, ${MAX_LINE_QTY})` } });
  }
  await tx.update(cartCart).set({ status: 'merged', mergedIntoId: target.id, updatedAt: now }).where(eq(cartCart.id, source.id));
  const [merged] = await tx
    .update(cartCart)
    .set({
      couponCode: target.couponCode ?? source.couponCode,
      planId: hasPackage ? source.planId : target.planId,
      landSqft: hasPackage ? source.landSqft : target.landSqft,
      contactAt: target.contactAt ?? source.contactAt,
      updatedAt: now,
    })
    .where(eq(cartCart.id, target.id))
    .returning();
  return merged!;
}

/**
 * The visitor's live cart. A signed-in customer gets their own cart; a guest cart found by cookie is merged
 * into it on the first read after sign-in (or simply claimed when the customer has none). A guest never sees
 * a customer's cart through a stale cookie.
 */
async function resolve(tx: Tx, ctx: CartContext, create: boolean): Promise<Resolved | null> {
  const now = ctx.now ?? new Date();
  const byCookie = await cartByToken(tx, ctx.token);
  if (ctx.customerId) {
    if (byCookie && byCookie.customerId === ctx.customerId) return { cart: byCookie, issuedToken: null, changed: false };
    const own = await customerCart(tx, ctx.customerId);
    if (byCookie && byCookie.customerId === null) {
      if (own) {
        return { cart: await mergeInto(tx, own, byCookie, now), issuedToken: null, changed: true };
      }
      const [claimed] = await tx.update(cartCart).set({ customerId: ctx.customerId, updatedAt: now }).where(eq(cartCart.id, byCookie.id)).returning();
      return { cart: claimed!, issuedToken: null, changed: false };
    }
    if (own) return { cart: own, issuedToken: null, changed: false };
  } else if (byCookie && byCookie.customerId === null) {
    return { cart: byCookie, issuedToken: null, changed: false };
  }
  if (!create) return null;
  if (ctx.createSubject) {
    const limit = await rateLimit(`cart-create:${ctx.createSubject}`, { ...CART_CREATE_LIMIT, now });
    if (!limit.ok) throw new CartError('rate_limited');
  }
  const token = newToken();
  const [cart] = await tx
    .insert(cartCart)
    .values({ cookieTokenHash: hashToken(token), customerId: ctx.customerId, lastActivityAt: now, createdAt: now, updatedAt: now })
    .returning();
  return { cart: cart!, issuedToken: token, changed: true };
}

/** Marks activity (re-opening an abandoned cart) and emits `cart.updated` at most once per UPDATED_EVENT_GAP_MS. */
async function touch(tx: Tx, cart: CartRow, now: Date, force = false): Promise<void> {
  const reopened = cart.status === 'abandoned';
  await tx.update(cartCart).set({ lastActivityAt: now, status: 'active', abandonedAt: null, updatedAt: now }).where(eq(cartCart.id, cart.id));
  if (force || reopened || now.getTime() - cart.lastActivityAt.getTime() >= UPDATED_EVENT_GAP_MS) await emit('cart.updated', { cartId: cart.id }, { tx });
}

export interface Mutation<T> {
  cartId: string;
  issuedToken: string | null;
  result: T;
}

async function mutate<T>(ctx: CartContext, create: boolean, fn: (tx: Tx, cart: CartRow, now: Date) => Promise<T>): Promise<Mutation<T> | null> {
  const now = ctx.now ?? new Date();
  return withTx(async (tx) => {
    const r = await resolve(tx, ctx, create);
    if (!r) return null;
    const result = await fn(tx, r.cart, now);
    await touch(tx, r.cart, now, r.changed);
    return { cartId: r.cart.id, issuedToken: r.issuedToken, result };
  });
}

/** Reads the visitor's cart without creating one (merging a guest cart on the first read after sign-in). */
export async function findCart(ctx: CartContext): Promise<CartRow | null> {
  return withTx(async (tx) => {
    const r = await resolve(tx, ctx, false);
    if (r?.changed) await touch(tx, r.cart, ctx.now ?? new Date(), true);
    return r?.cart ?? null;
  });
}

async function assertPurchasable(variantId: string): Promise<void> {
  const v = (await loadVariants([variantId]))[variantId];
  if (!v) throw new CartError('unknown_variant');
  if (!v.purchasable) throw new CartError('not_purchasable');
}

async function addProductQty(tx: Tx, cart: CartRow, variantId: string, qty: number, origin: unknown): Promise<number> {
  const [existing] = await tx.select({ id: cartLine.id }).from(cartLine).where(and(eq(cartLine.cartId, cart.id), eq(cartLine.variantId, variantId), eq(cartLine.kind, 'product')));
  if (!existing) {
    const [n] = await tx.select({ n: count() }).from(cartLine).where(eq(cartLine.cartId, cart.id));
    if (n!.n >= MAX_LINES) throw new CartError('too_many_lines');
  }
  const [row] = await tx
    .insert(cartLine)
    .values({ cartId: cart.id, variantId, qty: Math.min(qty, MAX_LINE_QTY), kind: 'product', origin: (origin ?? null) as Record<string, unknown> | null })
    .onConflictDoUpdate({ target: [cartLine.cartId, cartLine.variantId, cartLine.kind], set: { qty: sql`least(${cartLine.qty} + excluded.qty, ${MAX_LINE_QTY})` } })
    .returning({ qty: cartLine.qty });
  return row!.qty;
}

/** Adds `qty` of a variant as a product line (summing with an existing one). Returns the line's new quantity. */
export async function addLine(ctx: CartContext, input: AddLineInput): Promise<Mutation<number>> {
  const data = addLineSchema.parse(input);
  await assertPurchasable(data.variantId);
  return (await mutate(ctx, true, (tx, cart) => addProductQty(tx, cart, data.variantId, data.qty, data.origin)))!;
}

/** The catalog buttons' contract: change a product line by `delta`; at 0 or below the line goes. Returns the new quantity. */
export async function changeQty(ctx: CartContext, input: { variantId: string; delta: number }): Promise<Mutation<number> | { cartId: null; issuedToken: null; result: number }> {
  const data = deltaSchema.parse(input);
  if (data.delta > 0) return addLine(ctx, { variantId: data.variantId, qty: data.delta });
  const done = await mutate(ctx, false, async (tx, cart) => {
    const where = and(eq(cartLine.cartId, cart.id), eq(cartLine.variantId, data.variantId), eq(cartLine.kind, 'product'));
    const [line] = await tx.select().from(cartLine).where(where);
    if (!line) return 0;
    const next = line.qty + data.delta;
    if (next <= 0) {
      await tx.delete(cartLine).where(eq(cartLine.id, line.id));
      return 0;
    }
    await tx.update(cartLine).set({ qty: next }).where(eq(cartLine.id, line.id));
    return next;
  });
  return done ?? { cartId: null, issuedToken: null, result: 0 };
}

/** Sets a line (product or package) of the visitor's own cart; 0 removes it. Null when the line is not theirs. */
export async function setQty(ctx: CartContext, input: { lineId: string; qty: number }): Promise<number | null> {
  const data = setQtySchema.parse(input);
  const done = await mutate(ctx, false, async (tx, cart) => {
    const where = and(eq(cartLine.id, data.lineId), eq(cartLine.cartId, cart.id));
    if (data.qty === 0) return (await tx.delete(cartLine).where(where).returning({ id: cartLine.id })).length ? 0 : null;
    const [row] = await tx.update(cartLine).set({ qty: data.qty }).where(where).returning({ qty: cartLine.qty });
    return row?.qty ?? null;
  });
  return done?.result ?? null;
}

export const removeLine = (ctx: CartContext, lineId: string) => setQty(ctx, { lineId, qty: 0 });

/**
 * Replaces the cart's package lines with a new package (planting's "add package to cart"). Extra product lines
 * stay; the same plant in both zones sums for the bulk tier (pricing's cross-line summation). Variants that are
 * not purchasable are skipped and returned; unknown variants fail the whole call. An empty list removes the package.
 */
export async function replacePackage(ctx: CartContext, input: ReplacePackageInput): Promise<Mutation<{ lines: number; skipped: string[] }>> {
  const data = replacePackageSchema.parse(input);
  const merged = new Map<string, { qty: number; origin: unknown }>();
  for (const l of data.lines) {
    const prev = merged.get(l.variantId);
    merged.set(l.variantId, { qty: Math.min((prev?.qty ?? 0) + l.qty, MAX_LINE_QTY), origin: prev?.origin ?? l.origin });
  }
  const variants = await loadVariants([...merged.keys()]);
  const unknown = [...merged.keys()].filter((id) => !variants[id]);
  if (unknown.length) throw new CartError('unknown_variant');
  const skipped = [...merged.keys()].filter((id) => !variants[id]!.purchasable);
  const keep = [...merged.entries()].filter(([id]) => variants[id]!.purchasable);
  return (await mutate(ctx, true, async (tx, cart, now) => {
    await tx.delete(cartLine).where(and(eq(cartLine.cartId, cart.id), eq(cartLine.kind, 'package')));
    const [n] = await tx.select({ n: count() }).from(cartLine).where(eq(cartLine.cartId, cart.id));
    if (n!.n + keep.length > MAX_LINES) throw new CartError('too_many_lines');
    if (keep.length) {
      await tx.insert(cartLine).values(keep.map(([variantId, l]) => ({ cartId: cart.id, variantId, qty: l.qty, kind: 'package' as const, origin: (l.origin ?? null) as Record<string, unknown> | null, addedAt: now })));
    }
    await tx
      .update(cartCart)
      .set({ planId: keep.length ? data.packageId : null, landSqft: keep.length ? data.landSqft : null, updatedAt: now })
      .where(eq(cartCart.id, cart.id));
    return { lines: keep.length, skipped };
  }))!;
}

/** Stores (or clears) the coupon code once discounts accepted it. */
export async function storeCoupon(ctx: CartContext, code: string | null): Promise<boolean> {
  const done = await mutate(ctx, false, async (tx, cart, now) => {
    await tx.update(cartCart).set({ couponCode: code, updatedAt: now }).where(eq(cartCart.id, cart.id));
    return true;
  });
  return !!done;
}

/** Remembers the delivery method picked in the cart (checkout re-quotes it). */
export async function setDeliveryMethod(ctx: CartContext, methodId: string | null): Promise<boolean> {
  const done = await mutate(ctx, false, async (tx, cart, now) => {
    await tx
      .update(cartCart)
      .set({ deliveryMethodSnapshot: methodId ? { methodId } : null, updatedAt: now })
      .where(eq(cartCart.id, cart.id));
    return true;
  });
  return !!done;
}

export async function cartLines(cartId: string, conn: DbOrTx = db) {
  return conn.select().from(cartLine).where(eq(cartLine.cartId, cartId)).orderBy(desc(cartLine.kind), asc(cartLine.addedAt), asc(cartLine.id));
}

// ---- checkout hooks ----------------------------------------------------------------

/** Called by checkout inside the place-order transaction. A converted cart is never served again. */
export async function markConverted(cartId: string, orderId: string, options: { tx?: Tx; now?: Date } = {}): Promise<boolean> {
  const now = options.now ?? new Date();
  const rows = await (options.tx ?? db)
    .update(cartCart)
    .set({ status: 'converted', convertedOrderId: orderId, updatedAt: now })
    .where(and(eq(cartCart.id, cartId), inArray(cartCart.status, LIVE)))
    .returning({ id: cartCart.id });
  return rows.length > 0;
}

/** Called by checkout when a phone or email is saved for this cart: abandoned-cart payloads then carry hasContact. */
export async function noteContact(cartId: string, options: { tx?: Tx; now?: Date } = {}): Promise<void> {
  const now = options.now ?? new Date();
  await (options.tx ?? db)
    .update(cartCart)
    .set({ contactAt: sql`coalesce(${cartCart.contactAt}, ${now.toISOString()}::timestamptz)` })
    .where(eq(cartCart.id, cartId));
}

// ---- abandonment -------------------------------------------------------------------

/** `cart.abandoned` as emitted: the catalogue payload plus `hasContact` (requested as a contract addition). */
export type CartAbandonedPayload = EventPayloads['cart.abandoned'] & { hasContact: boolean };

/**
 * Marks carts with lines and no activity for `abandonAfterMinutes` as abandoned, one `cart.abandoned` each
 * (in the same transaction). A cart is abandoned once per idle stretch: activity re-opens it. Returns the count.
 */
export async function markAbandoned(options: { now?: Date; batch?: number } = {}): Promise<number> {
  const now = options.now ?? new Date();
  const { abandonAfterMinutes } = await readCartSettings();
  const cutoff = new Date(now.getTime() - abandonAfterMinutes * 60_000);
  return withTx(async (tx) => {
    const { rows } = await tx.execute<{ id: string; customer_id: string | null; contact_at: string | null }>(sql`
      update cart_cart c set status = 'abandoned', abandoned_at = ${now.toISOString()}::timestamptz, updated_at = ${now.toISOString()}::timestamptz
      where c.id in (
        select x.id from cart_cart x
        where x.status = 'active' and x.last_activity_at <= ${cutoff.toISOString()}::timestamptz
          and exists (select 1 from cart_line l where l.cart_id = x.id)
        order by x.last_activity_at
        limit ${options.batch ?? 500}
        for update skip locked)
      returning c.id, c.customer_id, c.contact_at`);
    for (const r of rows) {
      const payload: CartAbandonedPayload = { cartId: r.id, checkoutSessionId: null, hasContact: r.customer_id !== null || r.contact_at !== null };
      await emit('cart.abandoned', payload, { tx });
    }
    return rows.length;
  });
}

// ---- restore links -----------------------------------------------------------------

const RESTORE_PURPOSE = 'cart-restore';

/** A signed link token for reminder messages: `<cartId>.<expiry seconds>.<hmac>`. */
export async function restoreToken(cartId: string, options: { now?: Date } = {}): Promise<string> {
  const now = options.now ?? new Date();
  const { restoreLinkDays } = await readCartSettings();
  const exp = Math.floor(now.getTime() / 1000) + restoreLinkDays * 86_400;
  return `${cartId}.${exp}.${signInternal(`${cartId}.${exp}`, RESTORE_PURPOSE)}`;
}

/** Path flows put in messages; the route sets the cookie and lands on /cart. */
export const restorePath = (token: string) => `/api/cart/restore?t=${encodeURIComponent(token)}`;

export type RestoreResult = { ok: true; cartId: string; issuedToken: string | null } | { ok: false; reason: 'invalid' | 'expired' | 'gone' | 'sign_in' };

const RESTORE_RE = /^([0-9a-f-]{36})\.(\d{1,12})\.([0-9a-f]{64})$/;

/**
 * Opens the cart a restore link points at on this device. A guest cart gets a fresh cookie token (and absorbs
 * whatever guest cart the device had); a customer's cart needs that customer signed in.
 */
export async function restoreCart(ctx: CartContext, token: string): Promise<RestoreResult> {
  const now = ctx.now ?? new Date();
  const m = RESTORE_RE.exec(token);
  if (!m || !verifyInternal(`${m[1]}.${m[2]}`, m[3], RESTORE_PURPOSE)) return { ok: false, reason: 'invalid' };
  if (Number(m[2]) * 1000 <= now.getTime()) return { ok: false, reason: 'expired' };
  return withTx(async (tx) => {
    let [cart] = await tx.select().from(cartCart).where(eq(cartCart.id, m[1]!)).for('update');
    if (cart?.status === 'merged' && cart.mergedIntoId) [cart] = await tx.select().from(cartCart).where(eq(cartCart.id, cart.mergedIntoId)).for('update');
    if (!cart || !(LIVE as readonly string[]).includes(cart.status)) return { ok: false, reason: 'gone' } as const;
    if (cart.customerId) {
      return cart.customerId === ctx.customerId ? ({ ok: true, cartId: cart.id, issuedToken: null } as const) : ({ ok: false, reason: 'sign_in' } as const);
    }
    const current = await cartByToken(tx, ctx.token);
    if (current && current.id !== cart.id && current.customerId === null) cart = await mergeInto(tx, cart, current, now);
    const issued = newToken();
    await tx.update(cartCart).set({ cookieTokenHash: hashToken(issued), updatedAt: now }).where(eq(cartCart.id, cart.id));
    await touch(tx, cart, now, true);
    return { ok: true, cartId: cart.id, issuedToken: issued } as const;
  });
}
