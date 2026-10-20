import { randomBytes } from 'node:crypto';
import type { AppliedDiscountInput, CartBlock, ModuleId, ServiceKey, ServiceMap } from '@ecomkit/core/contracts';
import { newId } from '@ecomkit/core/ids';
import { createTestDb, queuedJobs, type TestDb } from '@ecomkit/core/testing';
import { pricingPrice, pricingTier } from '@ecomkit/pricing/schema';
import { configurePricing } from '@ecomkit/pricing/server';
import { configureCart, type CartDiscountsPort, type CartVariant, type CouponOutcome } from '../src/server';

/** Own database per test file (vitest runs files in parallel): ecomkit_wp_17_<suffix>. Real pricing tables. */
export async function cartDb(suffix: string): Promise<TestDb> {
  process.env.INTERNAL_SECRET ??= 'c'.repeat(40);
  process.env.SETTINGS_MASTER_KEY ??= `1:${randomBytes(32).toString('base64')}`;
  return createTestDb(`wp-17-${suffix}`, { schemas: ['core', 'pricing', 'cart'] });
}

/** Catalog stand-in: the variants the app would bind from the catalog server API. */
export const variants = new Map<string, CartVariant>();

export interface VariantSpec {
  kind?: 'plant' | 'input';
  name?: string;
  listPaise: number;
  tiers?: { minQty: number; unitPaise: number }[];
  gstPct?: number;
  weightKg?: number | null;
  purchasable?: boolean;
  priced?: boolean;
}

const gst = new Map<string, number>();

export async function makeVariant(t: TestDb, spec: VariantSpec): Promise<CartVariant> {
  const v: CartVariant = {
    variantId: newId(),
    productId: newId(),
    kind: spec.kind ?? 'plant',
    name: spec.name ?? `Plant ${variants.size + 1}`,
    nameKn: null,
    label: null,
    href: `/plant/p-${variants.size + 1}`,
    weightKg: spec.weightKg === undefined ? 2 : spec.weightKg,
    image: null,
    purchasable: spec.purchasable ?? true,
    collectionIds: [],
    tagIds: [],
  };
  variants.set(v.variantId, v);
  gst.set(v.productId, spec.gstPct ?? 0);
  if (spec.priced !== false) {
    await t.db.insert(pricingPrice).values({ variantId: v.variantId, productId: v.productId, pricePaise: spec.listPaise });
    if (spec.tiers?.length) await t.db.insert(pricingTier).values(spec.tiers.map((x) => ({ variantId: v.variantId, minQty: x.minQty, unitPricePaise: x.unitPaise })));
  }
  return v;
}

type Services = Partial<{ [K in ServiceKey]: ServiceMap[K] }>;

/** Binds pricing and the cart the way the app does at boot, with optional services and cart blocks. */
export function bind(options: { services?: Services; discounts?: CartDiscountsPort | null; blocks?: (CartBlock & { moduleId: ModuleId })[]; district?: string | null } = {}) {
  configurePricing({ gstRates: async (ids) => Object.fromEntries(ids.map((id) => [id, gst.get(id) ?? 0])), variantsOf: async () => [] });
  configureCart({
    variants: async (ids) => Object.fromEntries(ids.flatMap((id) => (variants.has(id) ? [[id, variants.get(id)!]] : []))),
    registry: {
      has: (id) => id === 'cart' || Object.keys(options.services ?? {}).some((k) => k === id),
      service: async (key) => (options.services?.[key] ?? null) as never,
      list: () => options.blocks ?? [],
    },
    discounts: options.discounts ?? null,
    readDistrict: async () => options.district ?? null,
  });
}

/** A discounts port that applies fixed amounts to the lines of given products (by product id). */
export function fakeDiscounts(spec: { promos?: { id: string; productId: string; amount: number; stackable?: boolean }[]; coupons?: Record<string, { productId: string; amount: number; stackable?: boolean }> }) {
  const calls = { apply: 0, evaluate: 0 };
  const build = (id: string, kind: 'automatic' | 'coupon', productId: string, amount: number, stackable: boolean, lines: { lineId: string; productId: string }[]): AppliedDiscountInput | null => {
    const line = lines.find((l) => l.productId === productId);
    return line ? { id, kind, label: id, stackable, allocations: [{ lineId: line.lineId, amountPaise: amount as never }] } : null;
  };
  const coupon = (code: string, lines: { lineId: string; productId: string }[]): CouponOutcome => {
    const c = spec.coupons?.[code.toUpperCase()];
    if (!c) return { ok: false, reason: 'invalid' };
    const d = build(code.toUpperCase(), 'coupon', c.productId, c.amount, c.stackable ?? false, lines);
    return d ? { ok: true, code: code.toUpperCase(), discount: d } : { ok: false, reason: 'no_matching_items' };
  };
  const port: CartDiscountsPort = {
    promos: async (cart) => (spec.promos ?? []).flatMap((p) => build(p.id, 'automatic', p.productId, p.amount, p.stackable ?? false, [...cart.lines]) ?? []),
    applyCoupon: async (code, cart) => {
      calls.apply++;
      return coupon(code, [...cart.lines]);
    },
    evaluateCoupon: async (code, cart) => {
      calls.evaluate++;
      return coupon(code, [...cart.lines]);
    },
  };
  return { port, calls };
}

/** Catalogue events written to the outbox (core.event jobs), optionally for one event name. */
export async function outboxEvents(t: TestDb, event?: string): Promise<{ event: string; payload: Record<string, unknown> }[]> {
  const jobs = await queuedJobs(t.db, 'core.event');
  return jobs.map((j) => j.data as { event: string; payload: Record<string, unknown> }).filter((e) => !event || e.event === event);
}
