'use client';

import { useEffect } from 'react';
import { CONSENT_COOKIE, parseConsent } from '../domain/consent';
import { purchaseTagPlan, type PurchaseTagData } from '../domain/conversions';
import { CONSENT_EVENT, readBrowserCookie, type MarketingWindow } from './browser';

/**
 * Fires the browser purchase tags once per order: Meta Pixel `Purchase` with the server's event_id (Meta keeps one
 * of pixel + CAPI) and the Google Ads conversion with the order number as transaction_id (Ads dedupes reloads).
 * GA4 purchase is sent from the server only. Waits for the tags to load (they load only after consent) and fires
 * nothing without marketing consent: analytics-only consent never sends the pixel, the Ads conversion or `user_data`.
 */
export function PurchaseTagsIsland({ data }: { data: PurchaseTagData }) {
  useEffect(() => {
    const key = `ek_fired_${data.eventId}`;
    let done = false;
    const fire = () => {
      const w = window as MarketingWindow;
      if (done || !(w.fbq || w.gtag)) return false;
      const plan = purchaseTagPlan(data, parseConsent(readBrowserCookie(CONSENT_COOKIE)));
      if (!plan.pixel && !plan.ads) return false;
      try {
        if (sessionStorage.getItem(key)) return (done = true);
      } catch {
        // storage blocked: the vendors still dedupe on event_id / transaction_id
      }
      if (plan.pixel) w.fbq?.('track', 'Purchase', { value: data.value, currency: data.currency, content_ids: data.contentIds, contents: data.contents, content_type: 'product' }, { eventID: data.eventId });
      if (plan.ads && w.gtag) {
        if (plan.userData) w.gtag('set', 'user_data', plan.userData);
        w.gtag('event', 'conversion', { send_to: data.adsSendTo, value: data.value, currency: data.currency, transaction_id: data.transactionId });
      }
      try {
        sessionStorage.setItem(key, '1');
      } catch {
        // ignore
      }
      return (done = true);
    };
    const timer = window.setInterval(() => fire() && window.clearInterval(timer), 1000);
    window.addEventListener(CONSENT_EVENT, fire);
    const stop = window.setTimeout(() => window.clearInterval(timer), 30_000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
      window.removeEventListener(CONSENT_EVENT, fire);
    };
  }, [data]);
  return null;
}
