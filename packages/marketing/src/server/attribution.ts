import { db, type DbOrTx } from '@ecomkit/core/db';
import { eq } from 'drizzle-orm';
import {
  CLICK_COOKIE,
  decodeJsonCookie,
  FIRST_TOUCH_COOKIE,
  fbcFrom,
  gaClientId,
  LAST_TOUCH_COOKIE,
  sanitiseClicks,
  sanitiseTouch,
  type Touch,
} from '../domain/attribution';
import { CONSENT_COOKIE, parseConsent } from '../domain/consent';
import { marketingAttribution, type AttributionRow } from '../schema';

/** `cookies()` from next/headers, or anything with the same `get`. */
export interface CookieReader {
  get(name: string): { value: string } | undefined;
}

export interface OrderAttribution {
  firstTouch: Touch | null;
  lastTouch: Touch | null;
  gclid: string | null;
  fbclid: string | null;
  fbp: string | null;
  fbc: string | null;
  gaClientId: string | null;
  consentAnalytics: boolean;
  consentMarketing: boolean;
  userAgent: string | null;
}

const FBP_RE = /^fb\.\d\.\d{10,13}\.\d{1,20}$/;
const FBC_RE = /^fb\.\d\.\d{10,13}\.[A-Za-z0-9_.-]{1,200}$/;

/**
 * Reads the first-party cookies the tag loader wrote (touches, click ids), the vendor cookies (`_ga`, `_fbp`, `_fbc`)
 * and the consent choice, at checkout. Every value is client-controlled, so each is validated or dropped.
 */
export function readAttribution(cookies: CookieReader, userAgent: string | null = null): OrderAttribution {
  const clicks = sanitiseClicks(decodeJsonCookie(cookies.get(CLICK_COOKIE)?.value));
  const consent = parseConsent(cookies.get(CONSENT_COOKIE)?.value);
  const fbpRaw = cookies.get('_fbp')?.value ?? null;
  const fbcRaw = cookies.get('_fbc')?.value ?? null;
  const fbc = fbcRaw && FBC_RE.test(fbcRaw) ? fbcRaw : clicks.fbclid ? fbcFrom(clicks.fbclid, clicks.fbclidAt ?? Date.now()) : null;
  return {
    firstTouch: sanitiseTouch(decodeJsonCookie(cookies.get(FIRST_TOUCH_COOKIE)?.value)),
    lastTouch: sanitiseTouch(decodeJsonCookie(cookies.get(LAST_TOUCH_COOKIE)?.value)),
    gclid: clicks.gclid ?? clicks.gbraid ?? clicks.wbraid,
    fbclid: clicks.fbclid,
    fbp: fbpRaw && FBP_RE.test(fbpRaw) ? fbpRaw : null,
    fbc,
    gaClientId: gaClientId(cookies.get('_ga')?.value),
    consentAnalytics: !!consent?.analytics,
    consentMarketing: !!consent?.marketing,
    userAgent: userAgent?.slice(0, 400) ?? null,
  };
}

/**
 * Stores the attribution on the order. Call it inside place-order's transaction (`tx`). Idempotent: a retried
 * place-order keeps the first row.
 */
export async function saveOrderAttribution(orderId: string, a: OrderAttribution, options: { tx?: DbOrTx } = {}): Promise<void> {
  await (options.tx ?? db)
    .insert(marketingAttribution)
    .values({ orderId, ...a })
    .onConflictDoNothing();
}

export async function getOrderAttribution(orderId: string): Promise<AttributionRow | null> {
  const [row] = await db.select().from(marketingAttribution).where(eq(marketingAttribution.orderId, orderId));
  return row ?? null;
}
