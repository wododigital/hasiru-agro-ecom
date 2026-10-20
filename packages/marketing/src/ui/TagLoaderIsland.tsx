'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import {
  CLICK_COOKIE,
  decodeJsonCookie,
  encodeJsonCookie,
  FIRST_TOUCH_COOKIE,
  LAST_TOUCH_COOKIE,
  TOUCH_MAX_AGE_SEC,
  touchFromUrl,
  type ClickIds,
  type Touch,
} from '../domain/attribution';
import { CONSENT_COOKIE, consentMode, parseConsent, type ConsentChoice } from '../domain/consent';
import { tagAppliesTo, type PublicTagConfig } from '../domain/tags';
import { CONSENT_EVENT, loadScript, readBrowserCookie, writeBrowserCookie, type MarketingWindow } from './browser';

/** The landing page's campaign data, held in memory until advertising consent allows writing the cookies. */
let landing: { touch: Touch | null; clicks: Partial<ClickIds> } | null = null;

function persistTouch(): void {
  if (!landing) return;
  if (landing.touch) {
    if (!readBrowserCookie(FIRST_TOUCH_COOKIE)) writeBrowserCookie(FIRST_TOUCH_COOKIE, encodeJsonCookie(landing.touch), TOUCH_MAX_AGE_SEC);
    writeBrowserCookie(LAST_TOUCH_COOKIE, encodeJsonCookie(landing.touch), TOUCH_MAX_AGE_SEC);
  }
  if (Object.keys(landing.clicks).length) {
    const prev = decodeJsonCookie<Partial<ClickIds>>(readBrowserCookie(CLICK_COOKIE)) ?? {};
    writeBrowserCookie(CLICK_COOKIE, encodeJsonCookie({ ...prev, ...landing.clicks }), TOUCH_MAX_AGE_SEC);
  }
  landing = null;
}

function ensureGtag(w: MarketingWindow): void {
  if (w.gtag) return;
  w.dataLayer = w.dataLayer ?? [];
  w.gtag = function gtag() {
    // gtag reads `arguments` objects from the data layer, not arrays.
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer!.push(arguments);
  };
}

function ensureFbq(w: MarketingWindow): void {
  if (w.fbq) return;
  const q: unknown[] = [];
  const fbq = Object.assign((...args: unknown[]) => (fbq.callMethod ? fbq.callMethod(...args) : q.push(args)), { queue: q, loaded: true, version: '2.0', callMethod: undefined as undefined | ((...a: unknown[]) => void) });
  w.fbq = fbq;
  w._fbq = fbq;
  loadScript('https://connect.facebook.net/en_US/fbevents.js');
}

function injectSnippet(id: string, snippet: string, placement: 'head' | 'body_end'): void {
  if (document.querySelector(`[data-ek-tag="${id}"]`)) return;
  const holder = document.createElement('div');
  holder.dataset.ekTag = id;
  holder.hidden = true;
  // createContextualFragment runs the snippet's scripts, the way a pasted vendor tag expects.
  holder.appendChild(document.createRange().createContextualFragment(snippet));
  (placement === 'head' ? document.head : document.body).appendChild(holder);
}

/**
 * Loads the vendor tags the visitor consented to, after the page is idle: GA4 (analytics), Google Ads and Meta Pixel
 * (advertising), and active custom tags for the current path. Sets Consent Mode v2 defaults to denied first.
 * Renders nothing.
 */
export function TagLoaderIsland({ config }: { config: PublicTagConfig }) {
  const pathname = usePathname();
  const loaded = useRef({ ga4: false, ads: false, meta: false });
  const choiceRef = useRef<ConsentChoice | null>(null);

  useEffect(() => {
    const w = window as MarketingWindow;
    if (!landing) landing = touchFromUrl(new URL(location.href), document.referrer || null, Date.now());
    const google = !!(config.ga4 || config.ads);
    if (google) {
      ensureGtag(w);
      w.gtag!('consent', 'default', { ...consentMode(null), wait_for_update: 500 });
    }
    const apply = () => {
      const choice = parseConsent(readBrowserCookie(CONSENT_COOKIE));
      choiceRef.current = choice;
      if (google) w.gtag!('consent', 'update', consentMode(choice));
      if (choice?.marketing) persistTouch();
      if (config.ga4 && choice?.analytics && !loaded.current.ga4) {
        loaded.current.ga4 = true;
        loadScript(`https://www.googletagmanager.com/gtag/js?id=${config.ga4}`);
        w.gtag!('js', new Date());
        w.gtag!('config', config.ga4);
      }
      if (config.ads && choice?.marketing && !loaded.current.ads) {
        loaded.current.ads = true;
        if (!loaded.current.ga4) loadScript(`https://www.googletagmanager.com/gtag/js?id=${config.ads.id}`);
        w.gtag!('js', new Date());
        w.gtag!('config', config.ads.id);
      }
      if (config.metaPixel && choice?.marketing && !loaded.current.meta) {
        loaded.current.meta = true;
        ensureFbq(w);
        w.fbq!('init', config.metaPixel);
        w.fbq!('track', 'PageView');
      }
      for (const tag of config.custom) {
        if ((!tag.requiresConsent || choice?.marketing) && tagAppliesTo(tag, location.pathname)) injectSnippet(tag.id, tag.snippet, tag.placement);
      }
    };
    const idle = (cb: () => void) => (typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(cb, { timeout: 3000 }) : setTimeout(cb, 1500));
    idle(apply);
    window.addEventListener(CONSENT_EVENT, apply);
    return () => window.removeEventListener(CONSENT_EVENT, apply);
  }, [config]);

  // Client navigations: Meta needs a PageView per route (GA4 tracks history changes itself); path-scoped tags.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const w = window as MarketingWindow;
    if (loaded.current.meta) w.fbq?.('track', 'PageView');
    const choice = choiceRef.current;
    for (const tag of config.custom) {
      if ((!tag.requiresConsent || choice?.marketing) && tagAppliesTo(tag, pathname)) injectSnippet(tag.id, tag.snippet, tag.placement);
    }
  }, [pathname, config]);

  return null;
}
