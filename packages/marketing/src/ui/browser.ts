// Browser-side helpers shared by the islands. Client-safe: no server imports.
import { META_STANDARD_EVENTS, GA4_BROWSER_EVENTS } from '../domain/conversions';

export const CONSENT_EVENT = 'ecomkit:consent';
export const CONSENT_OPEN_EVENT = 'ecomkit:consent-open';

type Fn = (...args: unknown[]) => void;
export interface MarketingWindow extends Window {
  dataLayer?: unknown[];
  gtag?: Fn;
  fbq?: Fn & { queue?: unknown[]; loaded?: boolean; version?: string; callMethod?: Fn; push?: Fn };
  _fbq?: unknown;
}

export function readBrowserCookie(name: string): string | null {
  for (const part of document.cookie.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function writeBrowserCookie(name: string, value: string, maxAgeSec: number): void {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=${value}; Path=/; Max-Age=${maxAgeSec}; SameSite=Lax${secure}`;
}

export function loadScript(src: string): void {
  if (document.querySelector(`script[src="${src}"]`)) return;
  const s = document.createElement('script');
  s.async = true;
  s.src = src;
  document.head.appendChild(s);
}

/** Reopens the consent banner (for a "Cookie settings" footer link). */
export function openConsentSettings(): void {
  window.dispatchEvent(new Event(CONSENT_OPEN_EVENT));
}

/**
 * Forwards a storefront event to the vendor tags that are loaded (they load only after consent). GA4 takes the
 * beacon name when it is a recommended ecommerce event; Meta gets the matching standard event with `eventId`
 * for pixel and server dedup. Purchase is not sent here (server-side, plus PurchaseTags on the confirmation page).
 */
export function marketingTrack(name: string, params: Record<string, unknown> = {}, options: { eventId?: string } = {}): void {
  const w = window as MarketingWindow;
  if (w.gtag && GA4_BROWSER_EVENTS.has(name)) w.gtag('event', name, params);
  const meta = META_STANDARD_EVENTS[name];
  if (w.fbq && meta && meta !== 'PageView') w.fbq('track', meta, params, options.eventId ? { eventID: options.eventId } : undefined);
}
