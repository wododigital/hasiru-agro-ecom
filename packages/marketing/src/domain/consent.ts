import { z } from 'zod';

/** First-party cookie holding the visitor's banner choice. Readable by the tag loader (not httpOnly), one year. */
export const CONSENT_COOKIE = 'ek_consent';
export const CONSENT_MAX_AGE_SEC = 365 * 24 * 3600;

export interface ConsentChoice {
  /** Measurement cookies (GA4). Recorded as purpose `analytics_identity`. */
  analytics: boolean;
  /** Ad pixels, conversion tags, CAPI with hashed contact data. Recorded as purpose `marketing`. */
  marketing: boolean;
  /** Epoch seconds of the choice. */
  at: number;
}

export const consentRequestSchema = z.object({ analytics: z.boolean(), marketing: z.boolean() }).strict();

/** `a1.m0.1760000000`: compact, no JSON quoting in the cookie. */
export function serializeConsent(c: ConsentChoice): string {
  return `a${c.analytics ? 1 : 0}.m${c.marketing ? 1 : 0}.${Math.floor(c.at)}`;
}

export function parseConsent(raw: string | null | undefined): ConsentChoice | null {
  const m = /^a([01])\.m([01])\.(\d{1,12})$/.exec(raw ?? '');
  return m ? { analytics: m[1] === '1', marketing: m[2] === '1', at: Number(m[3]) } : null;
}

export type ConsentSignal = 'granted' | 'denied';
export interface ConsentModeState {
  ad_storage: ConsentSignal;
  ad_user_data: ConsentSignal;
  ad_personalization: ConsentSignal;
  analytics_storage: ConsentSignal;
}

/** Google Consent Mode signals (including ad_user_data and ad_personalization) for a choice; no choice yet means everything denied. */
export function consentMode(choice: ConsentChoice | null): ConsentModeState {
  const ads: ConsentSignal = choice?.marketing ? 'granted' : 'denied';
  return { ad_storage: ads, ad_user_data: ads, ad_personalization: ads, analytics_storage: choice?.analytics ? 'granted' : 'denied' };
}
