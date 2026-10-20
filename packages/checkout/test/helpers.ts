import { randomBytes } from 'node:crypto';
import type { AppliedDiscountInput, Paise, TotalsInput, TotalsLineInput } from '@ecomkit/core/contracts';
import { orderNumber } from '@ecomkit/core/ids';
import { asPaise } from '@ecomkit/core/money';
import { createTestDb, fakeInventory, fakeShippingQuote, queuedJobs, type TestDb } from '@ecomkit/core/testing';
import type { CheckoutLine, CodMode } from '../src/domain';
import { configureCheckout, type CheckoutCart, type CheckoutOrderInput, type CheckoutOrderSummary } from '../src/server';

export async function checkoutDb(suffix: string): Promise<TestDb> {
  process.env.INTERNAL_SECRET ??= 'i'.repeat(40);
  process.env.SETTINGS_MASTER_KEY ??= `1:${randomBytes(32).toString('base64')}`;
  return createTestDb(`wp-19-checkout-${suffix}`, { schemas: ['core', 'customers', 'checkout'] });
}

// ---- the core totals fixture (packages/core/test/money-totals.test.ts), as a cart ----------------------------
const P = asPaise;
const fixtureLine = (lineId: string, list: number, tier: number, qty: number, gst: number, kg: number): TotalsLineInput => ({
  lineId,
  productId: `p-${lineId}`,
  variantId: `v-${lineId}`,
  qty,
  listUnitPaise: P(list),
  tierUnitPaise: P(tier),
  gstRatePct: gst,
  weightKg: kg,
});
const discount = (id: string, kind: 'automatic' | 'coupon', stackable: boolean, allocations: [string, number][]): AppliedDiscountInput => ({
  id,
  kind,
  label: id,
  stackable,
  allocations: allocations.map(([lineId, a]) => ({ lineId, amountPaise: P(a) })),
});
/** 50 saplings at the bulk tier (0% GST), 2 bags of compost (5%), 1 bio-pesticide (18%), packing + transport at 18%. */
export const CORE_FIXTURE: TotalsInput = {
  lines: [fixtureLine('plant', 49_000, 35_500, 50, 0, 2), fixtureLine('compost', 50_000, 50_000, 2, 5, 50), fixtureLine('bio', 30_000, 30_000, 1, 18, 1)],
  automaticPromos: [discount('compost-10', 'automatic', true, [['compost', 10_000]])],
  coupon: discount('SAVE500', 'coupon', false, [['plant', 50_000]]),
  packingPaise: P(20_000),
  transportPaise: P(150_000),
  chargesGstRatePct: 18,
  interState: false,
};

const META: Record<string, Pick<CheckoutLine, 'name' | 'sku' | 'hsn' | 'sizeClass' | 'packingFeePaise'>> = {
  plant: { name: 'Sapling A', sku: 'SKU-A', hsn: '0602', sizeClass: 'M', packingFeePaise: 400 },
  compost: { name: 'Compost 25 kg', sku: 'SKU-C', hsn: '3101', sizeClass: null, packingFeePaise: 0 },
  bio: { name: 'Bio pesticide', sku: 'SKU-B', hsn: '3808', sizeClass: null, packingFeePaise: 0 },
};

export function fixtureCart(id: string): CheckoutCart {
  return {
    id,
    customerId: null,
    couponCode: 'SAVE500',
    lines: CORE_FIXTURE.lines.map((l) => ({ ...l, ...META[l.lineId]!, kind: 'product' as const, origin: null })),
  };
}

export interface Harness {
  cart: CheckoutCart | null;
  converted: string[];
  created: CheckoutOrderInput[];
  orders: Map<string, CheckoutOrderSummary>;
  starts: { orderId: string; amountPaise: Paise }[];
  redeemed: unknown[];
  inventory: ReturnType<typeof fakeInventory>;
  codMode: CodMode;
  redeemFails: boolean;
}

/** Binds every checkout port to in-memory fakes; the order "module" takes a real number from core_sequence in the transaction. */
export function wire(cartId: string, overrides: Partial<Harness> = {}): Harness {
  const h: Harness = {
    cart: fixtureCart(cartId),
    converted: [],
    created: [],
    orders: new Map(),
    starts: [],
    redeemed: [],
    inventory: fakeInventory(),
    codMode: 'partial_advance',
    redeemFails: false,
    ...overrides,
  };
  configureCheckout({
    cart: {
      current: async () => (h.cart && !h.converted.includes(h.cart.id) ? h.cart : null),
      markConverted: async (id) => void h.converted.push(id),
    },
    orders: {
      createOrder: async (input, { tx }) => {
        const number = await orderNumber(tx, { prefix: 'T' });
        const id = crypto.randomUUID();
        h.created.push(input);
        h.orders.set(id, { id, number, status: input.initialStatus, totalPaise: input.totals.totalPaise, advancePaise: input.advancePaise, paidPaise: 0, contact: input.contact });
        return { id, number, guestToken: `tok-${id}` };
      },
      guestToken: (id) => `tok-${id}`,
      sellerStateCode: async () => 'KA',
      forBuyer: async (id, token) => (token === `tok-${id}` ? (h.orders.get(id) ?? null) : null),
    },
    payments: {
      config: async () => ({ codMode: h.codMode, advancePct: 30, attemptExpiryMinutes: 15 }),
      start: async (i) => {
        h.starts.push({ orderId: i.orderId, amountPaise: i.amountPaise });
        return { redirectUrl: `https://pay.example.test/${i.orderId}` };
      },
    },
    inventory: async () => h.inventory,
    shipping: async () => fakeShippingQuote(),
    discounts: {
      promos: async () => [...CORE_FIXTURE.automaticPromos],
      coupon: async (code) => (code === 'SAVE500' ? { ok: true, ruleId: 'SAVE500', codeId: 'code-1', discount: CORE_FIXTURE.coupon! } : { ok: false, reason: 'invalid' }),
      redeem: async (input) => {
        if (h.redeemFails) throw Object.assign(new Error('limit'), { name: 'RedemptionError' });
        h.redeemed.push(input);
      },
    },
    regions: { states: async () => [{ code: 'KA', name: 'Karnataka' }, { code: 'TN', name: 'Tamil Nadu' }] },
    attribution: async () => ({ utm_source: 'test' }),
  });
  return h;
}

export const ADDRESS = {
  name: 'Asha',
  phone: '9876543210',
  line1: '12 Farm Road',
  pincode: '560001',
  district: 'Bengaluru Urban',
  districtSlug: 'bengaluru-urban',
  state: 'Karnataka',
  stateCode: 'KA',
};

export async function outboxEvents(t: TestDb, event?: string): Promise<{ event: string; payload: Record<string, unknown> }[]> {
  const jobs = await queuedJobs(t.db, 'core.event');
  return jobs.map((j) => j.data as { event: string; payload: Record<string, unknown> }).filter((e) => !event || e.event === event);
}
