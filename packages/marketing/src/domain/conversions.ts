// Server-side conversion payloads: GA4 Measurement Protocol (purchase, refund) and Meta Conversions API
// (Purchase). Pure builders + the zod shapes the mocks validate against, so builder and mock share one spec.
import { z } from 'zod';

export interface ConversionLine {
  productId: string;
  variantId: string;
  sku: string;
  name: string;
  qty: number;
  /** GST-inclusive unit price actually charged. */
  unitPaise: number;
}

/** What marketing needs to know about an order. Provided by the host through `configureMarketing({ orders })`. */
export interface ConversionOrder {
  orderId: string;
  orderNumber: string;
  /** Grand total charged, GST-inclusive. */
  valuePaise: number;
  currency: 'INR';
  /** Test orders (staff test checkout, mock payments) never leave the store. */
  isTest: boolean;
  placedAt: Date;
  lines: readonly ConversionLine[];
  shippingPaise?: number | null;
  taxPaise?: number | null;
  couponCode?: string | null;
  customerId: string | null;
  contact: {
    email: string | null;
    /** E.164. */
    phone: string | null;
    firstName: string | null;
    lastName: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    /** ISO 3166-1 alpha-2, lowercase. */
    country: string | null;
  };
  /** The page the purchase completed on (CAPI `event_source_url`). */
  sourceUrl: string | null;
}

export interface OrdersPort {
  forConversion(orderId: string): Promise<ConversionOrder | null>;
}

export type ConversionName = 'purchase' | 'refund';

/** Shared with the browser pixel: Meta dedupes pixel + CAPI on (event_name, event_id) within 48 h. */
export const conversionEventId = (name: ConversionName, orderId: string): string => `${name}.${orderId}`;

/** Paise to the decimal amount analytics APIs take (2499.5). Not for display: use core formatINR there. */
export const toAmount = (paise: number): number => Math.round(paise) / 100;

// ---- GA4 Measurement Protocol ---------------------------------------------------------------------------

const ga4Name = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/);
const ga4Item = z.object({ item_id: z.string().min(1).max(100), item_name: z.string().min(1).max(100), price: z.number(), quantity: z.number().int().positive() }).loose();

export const ga4EventSchema = z
  .object({
    name: ga4Name,
    params: z.record(z.string(), z.unknown()).refine((p) => Object.keys(p).length <= 25, 'more_than_25_params'),
  })
  .superRefine((e, ctx) => {
    if (e.name === 'purchase' || e.name === 'refund') {
      if (typeof e.params.transaction_id !== 'string' || !e.params.transaction_id) ctx.addIssue({ code: 'custom', message: 'transaction_id is required', path: ['params', 'transaction_id'] });
      if (typeof e.params.value !== 'number') ctx.addIssue({ code: 'custom', message: 'value is required', path: ['params', 'value'] });
      if (typeof e.params.currency !== 'string' || !/^[A-Z]{3}$/.test(e.params.currency)) ctx.addIssue({ code: 'custom', message: 'currency is required with value', path: ['params', 'currency'] });
      if (e.params.items !== undefined && !z.array(ga4Item).max(200).safeParse(e.params.items).success) ctx.addIssue({ code: 'custom', message: 'items are invalid', path: ['params', 'items'] });
    }
  });

export const ga4BodySchema = z.object({
  client_id: z.string().min(1).max(100),
  user_id: z.string().max(256).optional(),
  timestamp_micros: z.number().int().positive().optional(),
  consent: z.object({ ad_user_data: z.enum(['GRANTED', 'DENIED']), ad_personalization: z.enum(['GRANTED', 'DENIED']) }).optional(),
  events: z.array(ga4EventSchema).min(1).max(25),
});
export type Ga4Body = z.infer<typeof ga4BodySchema>;

export interface Ga4Context {
  clientId: string;
  marketingConsent: boolean;
  nowMs: number;
}

export function ga4Purchase(order: ConversionOrder, ctx: Ga4Context): Ga4Body {
  return {
    client_id: ctx.clientId,
    timestamp_micros: ctx.nowMs * 1000,
    consent: ctx.marketingConsent ? { ad_user_data: 'GRANTED', ad_personalization: 'GRANTED' } : { ad_user_data: 'DENIED', ad_personalization: 'DENIED' },
    events: [
      {
        name: 'purchase',
        params: {
          transaction_id: order.orderNumber,
          value: toAmount(order.valuePaise),
          currency: order.currency,
          ...(order.taxPaise != null ? { tax: toAmount(order.taxPaise) } : {}),
          ...(order.shippingPaise != null ? { shipping: toAmount(order.shippingPaise) } : {}),
          ...(order.couponCode ? { coupon: order.couponCode } : {}),
          items: order.lines.slice(0, 200).map((l) => ({ item_id: l.sku, item_name: l.name.slice(0, 100), price: toAmount(l.unitPaise), quantity: l.qty })),
          engagement_time_msec: 1,
        },
      },
    ],
  };
}

export function ga4Refund(order: ConversionOrder, amountPaise: number, ctx: Ga4Context): Ga4Body {
  return {
    client_id: ctx.clientId,
    timestamp_micros: ctx.nowMs * 1000,
    events: [{ name: 'refund', params: { transaction_id: order.orderNumber, value: toAmount(amountPaise), currency: order.currency, engagement_time_msec: 1 } }],
  };
}

// ---- Meta Conversions API ----------------------------------------------------------------------------------

/** Normalisation before SHA-256 (Meta customer information parameters). Null means "do not send". */
export const metaNormalise = {
  email: (v: string | null | undefined) => (v && v.includes('@') ? v.trim().toLowerCase() : null),
  /** Digits only, with country code (E.164 without the plus). */
  phone: (v: string | null | undefined) => {
    const d = (v ?? '').replace(/\D/g, '');
    return d.length >= 8 ? d : null;
  },
  /** Lowercase letters only (UTF-8 kept), no punctuation or spaces. */
  name: (v: string | null | undefined) => (v ? v.trim().toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '') || null : null),
  city: (v: string | null | undefined) => (v ? v.trim().toLowerCase().replace(/[\s\p{P}\p{S}\d]/gu, '') || null : null),
  state: (v: string | null | undefined) => (v ? v.trim().toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '') || null : null),
  zip: (v: string | null | undefined) => (v ? v.trim().toLowerCase().replace(/\s/g, '') || null : null),
  country: (v: string | null | undefined) => (v && /^[a-zA-Z]{2}$/.test(v.trim()) ? v.trim().toLowerCase() : null),
};

const HEX64 = /^[0-9a-f]{64}$/;
const hashed = z.union([z.string().regex(HEX64), z.array(z.string().regex(HEX64)).min(1)]);
const MAX_AGE_SEC = 7 * 24 * 3600;

export const capiEventSchema = z
  .object({
    event_name: z.string().min(1).max(100),
    event_time: z.number().int().positive(),
    event_id: z.string().min(1).max(200).optional(),
    action_source: z.enum(['website', 'app', 'email', 'phone_call', 'chat', 'physical_store', 'system_generated', 'business_messaging', 'other']),
    event_source_url: z.url().optional(),
    user_data: z
      .object({
        em: hashed.optional(),
        ph: hashed.optional(),
        fn: hashed.optional(),
        ln: hashed.optional(),
        ct: hashed.optional(),
        st: hashed.optional(),
        zp: hashed.optional(),
        country: hashed.optional(),
        external_id: hashed.optional(),
        client_ip_address: z.string().max(64).optional(),
        client_user_agent: z.string().max(1000).optional(),
        fbp: z.string().regex(/^fb\.\d\.\d+\.\d+$/).optional(),
        fbc: z.string().regex(/^fb\.\d\.\d+\..+$/).optional(),
      })
      .strict(),
    custom_data: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((e, ctx) => {
    if (e.action_source === 'website') {
      if (!e.event_source_url) ctx.addIssue({ code: 'custom', message: 'event_source_url is required for website events', path: ['event_source_url'] });
      if (!e.user_data.client_user_agent) ctx.addIssue({ code: 'custom', message: 'client_user_agent is required for website events', path: ['user_data', 'client_user_agent'] });
    }
    const keys = ['em', 'ph', 'external_id', 'fbp', 'fbc', 'client_ip_address'] as const;
    if (!keys.some((k) => e.user_data[k])) ctx.addIssue({ code: 'custom', message: 'user_data needs at least one customer identifier', path: ['user_data'] });
  });

export const capiBodySchema = z.object({ data: z.array(capiEventSchema).min(1).max(1000), test_event_code: z.string().max(50).optional() });
export type CapiBody = z.infer<typeof capiBodySchema>;
export type CapiEvent = z.infer<typeof capiEventSchema>;

/** event_time within Meta's window: at most 7 days old, at most a minute ahead. */
export function capiTimeIssue(eventTime: number, nowSec: number): string | null {
  if (eventTime > nowSec + 60) return 'event_time is in the future';
  if (eventTime < nowSec - MAX_AGE_SEC) return 'event_time is older than 7 days';
  return null;
}

export interface CapiContext {
  /** SHA-256 hex of a normalised value (server provides it; domain stays crypto-free for client bundles). */
  sha256: (value: string) => string;
  nowSec: number;
  fbp: string | null;
  fbc: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  sourceUrl: string;
  testEventCode?: string | null;
}

export function capiPurchase(order: ConversionOrder, ctx: CapiContext): CapiBody {
  const h = (v: string | null) => (v ? [ctx.sha256(v)] : undefined);
  const c = order.contact;
  const userData: CapiEvent['user_data'] = Object.fromEntries(
    Object.entries({
      em: h(metaNormalise.email(c.email)),
      ph: h(metaNormalise.phone(c.phone)),
      fn: h(metaNormalise.name(c.firstName)),
      ln: h(metaNormalise.name(c.lastName)),
      ct: h(metaNormalise.city(c.city)),
      st: h(metaNormalise.state(c.state)),
      zp: h(metaNormalise.zip(c.pincode)),
      country: h(metaNormalise.country(c.country)),
      external_id: h(order.customerId),
      client_ip_address: ctx.ipAddress ?? undefined,
      client_user_agent: ctx.userAgent ?? undefined,
      fbp: ctx.fbp ?? undefined,
      fbc: ctx.fbc ?? undefined,
    }).filter(([, v]) => v !== undefined),
  );
  return {
    data: [
      {
        event_name: 'Purchase',
        event_time: Math.min(ctx.nowSec, Math.floor(order.placedAt.getTime() / 1000)),
        event_id: conversionEventId('purchase', order.orderId),
        action_source: 'website',
        event_source_url: ctx.sourceUrl,
        user_data: userData,
        custom_data: {
          currency: order.currency,
          value: toAmount(order.valuePaise),
          order_id: order.orderNumber,
          content_type: 'product',
          content_ids: order.lines.map((l) => l.sku),
          contents: order.lines.map((l) => ({ id: l.sku, quantity: l.qty, item_price: toAmount(l.unitPaise) })),
          num_items: order.lines.reduce((n, l) => n + l.qty, 0),
        },
      },
    ],
    ...(ctx.testEventCode ? { test_event_code: ctx.testEventCode } : {}),
  };
}

export interface PurchaseTagData {
  eventId: string;
  transactionId: string;
  value: number;
  currency: string;
  contentIds: string[];
  contents: { id: string; quantity: number; item_price: number }[];
  adsSendTo: string | null;
  enhanced: { email: string | null; phone_number: string | null } | null;
}

// ---- browser events ------------------------------------------------------------------------------------------

/** Storefront beacon names (core TRACK_EVENTS) that map to a Meta standard event. GA4 takes the beacon names as they are. */
export const META_STANDARD_EVENTS: Readonly<Record<string, string>> = {
  page_view: 'PageView',
  view_item: 'ViewContent',
  add_to_cart: 'AddToCart',
  begin_checkout: 'InitiateCheckout',
  add_payment_info: 'AddPaymentInfo',
  search: 'Search',
  enquiry_submit: 'Lead',
  plan_unlocked: 'Lead',
};

/** GA4 recommended ecommerce events sent from the browser. `purchase` and `refund` are server-only (one source, no double count). */
export const GA4_BROWSER_EVENTS = new Set([
  'view_item_list',
  'select_item',
  'view_item',
  'add_to_cart',
  'remove_from_cart',
  'view_cart',
  'begin_checkout',
  'add_shipping_info',
  'add_payment_info',
  'search',
  'generate_lead',
]);
