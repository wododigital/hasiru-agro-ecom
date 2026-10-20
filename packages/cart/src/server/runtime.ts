import type { AppliedDiscountInput, CartBlock, ImageRef, ModuleId, ServiceKey, ServiceMap } from '@ecomkit/core/contracts';
import { cartMessages, mergeMessages, type CartMessages, type CartMessagesOverride } from '../messages';

/** What the cart needs to know about a catalog variant (bound by the app from the catalog server API). */
export interface CartVariant {
  variantId: string;
  productId: string;
  kind: 'plant' | 'input';
  name: string;
  nameKn: string | null;
  /** Variant label ("Grafted, 2 ft"); null when the product has one variant. */
  label: string | null;
  href: string;
  /** catalog_variant.weight_kg per unit. */
  weightKg: number | null;
  image: ImageRef | null;
  /** Active and not out of stock without pre-order; a line that is no longer purchasable stays but leaves the totals. */
  purchasable: boolean;
  collectionIds?: readonly string[];
  tagIds?: readonly string[];
}

/** A cart as the discounts module reads it (lines at the bulk-tier unit price, A8). */
export interface DiscountCartInput {
  lines: readonly { lineId: string; productId: string; qty: number; unitPaise: number; collectionIds?: readonly string[]; tagIds?: readonly string[] }[];
  customer: { isFirstOrder: boolean; segmentIds: readonly string[] } | null;
}

export type CouponOutcome = { ok: true; code: string; discount: AppliedDiscountInput } | { ok: false; reason: string; shortBy?: number };

/** Optional discounts port (the discounts module has no ServiceMap key); absent means no promos and no coupon field. */
export interface CartDiscountsPort {
  promos(cart: DiscountCartInput): Promise<AppliedDiscountInput[]>;
  /** A code the shopper typed: rate-limited per `subject`. */
  applyCoupon(code: string, cart: DiscountCartInput, ctx: { subject: string; customerId: string | null }): Promise<CouponOutcome>;
  /** Re-checks a code already accepted on this cart (every view), without spending the typing rate limit. */
  evaluateCoupon(code: string, cart: DiscountCartInput, ctx: { customerId: string | null }): Promise<CouponOutcome>;
}

/** The part of the app registry the cart reads. */
export interface CartRegistry {
  has(id: ModuleId): boolean;
  service<K extends ServiceKey>(key: K): Promise<ServiceMap[K] | null>;
  list(key: 'cartBlocks'): readonly (CartBlock & { moduleId: ModuleId })[];
}

export interface CartRuntimeInput {
  variants?: ((variantIds: readonly string[]) => Promise<Record<string, CartVariant>>) | null;
  registry?: CartRegistry | null;
  discounts?: CartDiscountsPort | null;
  /** Visitor district slug for delivery quotes; default reads the `district` cookie. */
  readDistrict?: (() => Promise<string | null>) | null;
  messages?: CartMessagesOverride;
}

export interface CartRuntime {
  variants: ((variantIds: readonly string[]) => Promise<Record<string, CartVariant>>) | null;
  registry: CartRegistry | null;
  discounts: CartDiscountsPort | null;
  readDistrict: () => Promise<string | null>;
  messages: CartMessages;
}

const KEY = Symbol.for('ecomkit.cart.runtime');
type Holder = { [KEY]?: CartRuntime };

async function districtFromCookie(): Promise<string | null> {
  try {
    const { cookies } = await import('next/headers');
    const v = (await cookies()).get('district')?.value ?? null;
    return v && /^[a-z0-9-]{2,60}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

function build(input: CartRuntimeInput): CartRuntime {
  return {
    variants: input.variants ?? null,
    registry: input.registry ?? null,
    discounts: input.discounts ?? null,
    readDistrict: input.readDistrict ?? districtFromCookie,
    messages: input.messages ? mergeMessages(input.messages) : cartMessages,
  };
}

/** Binds the host's capabilities once at boot (instrumentation and worker). Kept on globalThis so every bundle sees one value. */
export function configureCart(input: CartRuntimeInput): void {
  (globalThis as Holder)[KEY] = build(input);
}

export function cartRuntime(): CartRuntime {
  return ((globalThis as Holder)[KEY] ??= build({}));
}

export async function loadVariants(ids: readonly string[]): Promise<Record<string, CartVariant>> {
  const fn = cartRuntime().variants;
  if (!fn) throw new Error('cart is not configured: call configureCart({ variants }) at boot');
  return ids.length ? fn([...new Set(ids)]) : {};
}

export async function optionalService<K extends ServiceKey>(key: K): Promise<ServiceMap[K] | null> {
  const r = cartRuntime().registry;
  return r ? r.service(key) : null;
}
