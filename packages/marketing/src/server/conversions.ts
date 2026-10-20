import { createHash } from 'node:crypto';
import type { EventHandler, Logger } from '@ecomkit/core/contracts';
import { db } from '@ecomkit/core/db';
import { requirePermission } from '@ecomkit/core/auth-context';
import { integrationCall } from '@ecomkit/core/http';
import { and, desc, eq } from 'drizzle-orm';
import {
  capiPurchase,
  conversionEventId,
  ga4Purchase,
  ga4Refund,
  toAmount,
  type ConversionOrder,
  type OrdersPort,
  type PurchaseTagData,
} from '../domain/conversions';
import { marketingConversionEvent, type ConversionEventRow } from '../schema';
import type { MarketingSettings } from '../settings';
import { getOrderAttribution } from './attribution';
import { loadSettings, mockBase, siteUrl, vendorHttp, type Http } from './config';

// On globalThis: instrumentation (boot) and route bundles are separate module instances in Next.
const deps: { orders: OrdersPort | null; http: Http | null } = ((globalThis as Record<symbol, { orders: OrdersPort | null; http: Http | null } | undefined>)[Symbol.for('ecomkit.marketing.deps')] ??= { orders: null, http: null });

/**
 * Boot wiring (host app): `configureMarketing({ orders: { forConversion } })` from the orders module. Without it
 * server-side conversions are skipped (logged); the browser tags still work.
 */
export function configureMarketing(next: { orders?: OrdersPort | null; http?: Http | null }): void {
  if (next.orders !== undefined) deps.orders = next.orders;
  if (next.http !== undefined) deps.http = next.http;
}

export const sha256Hex = (v: string): string => createHash('sha256').update(v, 'utf8').digest('hex');

type Destination = 'ga4' | 'meta';
type SkipStatus = 'skipped_test' | 'skipped_consent' | 'skipped_not_configured';
export interface ConversionResult {
  destination: Destination;
  eventId: string;
  status: ConversionEventRow['status'] | 'duplicate';
}

const GA4_HOSTS = ['www.google-analytics.com', 'region1.google-analytics.com'];
const META_HOSTS = ['graph.facebook.com'];

function ga4Configured(s: MarketingSettings): s is MarketingSettings & { ga4ApiSecret: string } {
  return s.ga4Mode !== 'off' && !!s.ga4MeasurementId && !!s.ga4ApiSecret;
}
function metaConfigured(s: MarketingSettings): s is MarketingSettings & { metaCapiToken: string } {
  return s.metaMode !== 'off' && !!s.metaPixelId && !!s.metaCapiToken;
}

/** Claims (destination, eventId). Returns the row to work on, or null when it is already settled (sent or skipped). */
async function claim(destination: Destination, eventId: string, name: string, orderId: string, status: 'pending' | SkipStatus): Promise<ConversionEventRow | null> {
  const [inserted] = await db.insert(marketingConversionEvent).values({ eventId, name, orderId, destination, status }).onConflictDoNothing().returning();
  if (inserted) return inserted;
  const [existing] = await db.select().from(marketingConversionEvent).where(and(eq(marketingConversionEvent.destination, destination), eq(marketingConversionEvent.eventId, eventId)));
  return existing && (existing.status === 'pending' || existing.status === 'failed') ? existing : null;
}

async function post(provider: string, op: string, ref: string, http: Http, url: string, body: unknown): Promise<{ ok: boolean; response: unknown }> {
  const result = await integrationCall(
    provider,
    op,
    async () => {
      const res = await http(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const text = await res.text();
      let parsed: unknown = text.slice(0, 2000);
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        // keep the text
      }
      if (!res.ok) throw Object.assign(new Error(`${provider} answered ${res.status}`), { status: res.status, response: parsed });
      return { status: res.status, body: parsed };
    },
    { ref },
  );
  if (result.status === 'ok') return { ok: true, response: result.value };
  if (result.status === 'skipped_not_configured') return { ok: false, response: { error: 'not_configured' } };
  return { ok: false, response: { error: result.error.message, detail: (result.error as { response?: unknown }).response ?? null } };
}

/**
 * Sends one order conversion server-side: GA4 Measurement Protocol (purchase, refund) and Meta Conversions API
 * (Purchase, same event_id as the browser pixel). Test orders, missing consent and unconfigured destinations are
 * recorded as skipped and never sent. Idempotent per (destination, event_id); throws when a send failed so the
 * event job retries only the failed destination.
 */
export async function conversion(
  name: 'purchase' | 'refund',
  orderId: string,
  options: { refundId?: string; amountPaise?: number; now?: Date; log?: Logger } = {},
): Promise<ConversionResult[]> {
  const log = options.log;
  const orders = deps.orders;
  if (!orders) {
    log?.warn('marketing: no orders port configured, conversion skipped', { orderId, name });
    return [];
  }
  const order: ConversionOrder | null = await orders.forConversion(orderId);
  if (!order) {
    log?.warn('marketing: order not found for conversion', { orderId, name });
    return [];
  }
  const [s, attribution] = await Promise.all([loadSettings(), getOrderAttribution(orderId)]);
  const now = options.now ?? new Date();
  const results: ConversionResult[] = [];
  const failures: string[] = [];
  const eventId = name === 'refund' ? `refund.${options.refundId ?? orderId}` : conversionEventId('purchase', orderId);

  const run = async (destination: Destination, consented: boolean, configured: boolean, send: () => Promise<{ ok: boolean; response: unknown }>) => {
    const skip: SkipStatus | null = order.isTest ? 'skipped_test' : !configured ? 'skipped_not_configured' : !consented ? 'skipped_consent' : null;
    const row = await claim(destination, eventId, name, orderId, skip ?? 'pending');
    if (!row) return results.push({ destination, eventId, status: 'duplicate' });
    if (skip) return results.push({ destination, eventId, status: skip });
    const sent = await send();
    const status = sent.ok ? 'sent' : 'failed';
    await db.update(marketingConversionEvent).set({ status, response: sent.response as object, updatedAt: new Date() }).where(eq(marketingConversionEvent.id, row.id));
    if (!sent.ok) failures.push(destination);
    results.push({ destination, eventId, status });
  };

  // GA4: purchase and refund. Measurement needs analytics consent.
  await run('ga4', !!attribution?.consentAnalytics, ga4Configured(s), async () => {
    const mode = s.ga4Mode as 'mock' | 'live';
    const ctx = { clientId: attribution?.gaClientId ?? `order.${orderId}`, marketingConsent: !!attribution?.consentMarketing, nowMs: now.getTime() };
    const body = name === 'refund' ? ga4Refund(order, options.amountPaise ?? order.valuePaise, ctx) : ga4Purchase(order, ctx);
    const base = mode === 'mock' ? `${mockBase('ga4')}/mp/collect` : 'https://www.google-analytics.com/mp/collect';
    const url = `${base}?measurement_id=${encodeURIComponent(s.ga4MeasurementId)}&api_secret=${encodeURIComponent(s.ga4ApiSecret!)}`;
    return post('ga4', name, orderId, deps.http ?? vendorHttp(mode, GA4_HOSTS), url, body);
  });

  // Meta: Purchase only (Meta has no refund event). Hashed contact data needs advertising consent.
  if (name === 'purchase') {
    await run('meta', !!attribution?.consentMarketing, metaConfigured(s), async () => {
      const mode = s.metaMode as 'mock' | 'live';
      const body = capiPurchase(order, {
        sha256: sha256Hex,
        nowSec: Math.floor(now.getTime() / 1000),
        fbp: attribution?.fbp ?? null,
        fbc: attribution?.fbc ?? null,
        ipAddress: null,
        userAgent: attribution?.userAgent ?? null,
        sourceUrl: order.sourceUrl ?? siteUrl('/checkout'),
        testEventCode: s.metaTestEventCode || null,
      });
      const base = mode === 'mock' ? mockBase('meta-capi') : 'https://graph.facebook.com';
      const url = `${base}/${s.metaGraphVersion}/${s.metaPixelId}/events`;
      return post('meta_capi', 'purchase', orderId, deps.http ?? vendorHttp(mode, META_HOSTS), url, { ...body, access_token: s.metaCapiToken });
    });
  }

  if (failures.length) throw new Error(`conversion ${eventId} failed for ${failures.join(', ')}`);
  return results;
}

export const onOrderPaid: EventHandler<'order.paid'> = async (payload, ctx) => {
  await conversion('purchase', payload.orderId, { log: ctx.log });
};

export const onOrderRefunded: EventHandler<'order.refunded'> = async (payload, ctx) => {
  await conversion('refund', payload.orderId, { refundId: payload.refundId, amountPaise: payload.amountPaise, log: ctx.log });
};

/** Data for the browser purchase tags on the order confirmation page; null for test orders or without the orders port. */
export async function purchaseTagData(orderId: string): Promise<PurchaseTagData | null> {
  const orders = deps.orders;
  if (!orders) return null;
  const order = await orders.forConversion(orderId);
  if (!order || order.isTest) return null;
  const s = await loadSettings();
  return {
    eventId: conversionEventId('purchase', orderId),
    transactionId: order.orderNumber,
    value: toAmount(order.valuePaise),
    currency: order.currency,
    contentIds: order.lines.map((l) => l.sku),
    contents: order.lines.map((l) => ({ id: l.sku, quantity: l.qty, item_price: toAmount(l.unitPaise) })),
    adsSendTo: s.adsConversionId && s.adsPurchaseLabel ? `${s.adsConversionId}/${s.adsPurchaseLabel}` : null,
    enhanced: s.adsEnhancedConversions ? { email: order.contact.email, phone_number: order.contact.phone } : null,
  };
}


export async function listConversions(options: { page?: number; pageSize?: number } = {}): Promise<ConversionEventRow[]> {
  await requirePermission('marketing.write');
  const pageSize = options.pageSize ?? 25;
  return db
    .select()
    .from(marketingConversionEvent)
    .orderBy(desc(marketingConversionEvent.createdAt), desc(marketingConversionEvent.id))
    .limit(pageSize)
    .offset(((options.page ?? 1) - 1) * pageSize);
}
