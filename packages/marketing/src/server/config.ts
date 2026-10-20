import { cacheFor, tags } from '@ecomkit/core/cache-tags';
import { db } from '@ecomkit/core/db';
import { env } from '@ecomkit/core/env';
import { safeFetch } from '@ecomkit/core/http';
import { defineSettings, getSettings } from '@ecomkit/core/settings';
import { asc, eq } from 'drizzle-orm';
import { cspSourcesFor, type BuiltInVendor, type CspSources } from '../domain/csp';
import type { PublicTagConfig } from '../domain/tags';
import { marketingTag } from '../schema';
import { marketingSettingsSchema, type MarketingSettings } from '../settings';

export const settingsDef = defineSettings('marketing', marketingSettingsSchema);
export const loadSettings = (): Promise<MarketingSettings> => getSettings(settingsDef);
export const SETTINGS_TAG = tags.settings('marketing');

export async function readPublicTagConfig(): Promise<PublicTagConfig> {
  const [s, custom] = await Promise.all([
    loadSettings(),
    db
      .select({ id: marketingTag.id, placement: marketingTag.placement, scope: marketingTag.scope, paths: marketingTag.paths, snippet: marketingTag.snippet, requiresConsent: marketingTag.requiresConsent })
      .from(marketingTag)
      .where(eq(marketingTag.isActive, true))
      .orderBy(asc(marketingTag.createdAt), asc(marketingTag.id)),
  ]);
  return {
    banner: s.consentBanner,
    ga4: s.ga4MeasurementId || null,
    metaPixel: s.metaPixelId || null,
    ads: s.adsConversionId ? { id: s.adsConversionId, purchaseLabel: s.adsPurchaseLabel || null, enhanced: s.adsEnhancedConversions } : null,
    custom,
  };
}

/** Cached for the static storefront shell; expired by every settings or tag write (`settings:marketing`). */
export async function publicTagConfig(): Promise<PublicTagConfig> {
  'use cache';
  cacheFor([SETTINGS_TAG]);
  return readPublicTagConfig();
}

async function readCspSources(): Promise<CspSources> {
  const [s, custom] = await Promise.all([loadSettings(), db.select({ hosts: marketingTag.cspSources }).from(marketingTag).where(eq(marketingTag.isActive, true))]);
  const vendors: BuiltInVendor[] = [];
  if (s.ga4MeasurementId) vendors.push('ga4');
  if (s.metaPixelId) vendors.push('meta_pixel');
  if (s.adsConversionId) vendors.push('google_ads');
  return cspSourcesFor(vendors, custom.flatMap((r) => r.hosts));
}

const CSP_TTL_MS = 60_000;
let cspMemo: { at: number; value: Promise<CspSources> } | null = null;

/**
 * Vendor hosts for the storefront CSP, for `proxy.ts`. Memoised in the process for a minute so the proxy never
 * queries per request; a failed read answers "no vendors" (tags then fail to load, the page still works).
 */
export function cspSources(now = Date.now()): Promise<CspSources> {
  if (!cspMemo || now - cspMemo.at > CSP_TTL_MS) {
    cspMemo = { at: now, value: readCspSources().catch(() => cspSourcesFor([], [])) };
  }
  return cspMemo.value;
}

/** Forget the memo (after a tag or settings write in this process; tests). */
export function resetCspMemo(): void {
  cspMemo = null;
}

export type Http = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string }) => Promise<Response>;

/** Live sends go through the SSRF-guarded safeFetch with the vendor allowlist; mock posts to the in-app mock routes. */
export function vendorHttp(mode: 'mock' | 'live', allowHosts: readonly string[]): Http {
  if (mode === 'mock') return (url, init) => fetch(url, init);
  return (url, init) => safeFetch(url, init, { allowHosts, timeoutMs: 10_000 });
}

export const mockBase = (provider: 'ga4' | 'meta-capi') => `${env.INTERNAL_BASE_URL.replace(/\/$/, '')}/api/_mock/${provider}`;

/** Absolute URL on the canonical host (event_source_url). */
export const siteUrl = (path: string) => new URL(path, env.SITE_URL ?? env.INTERNAL_BASE_URL).toString();
