export interface Touch {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  term: string | null;
  content: string | null;
  referrerHost: string | null;
  landingPath: string | null;
  at: number;
}

/** First touch is written once; last touch on every landing that carries campaign data. 90 days. */
export const FIRST_TOUCH_COOKIE = 'ek_ft';
export const LAST_TOUCH_COOKIE = 'ek_lt';
export const CLICK_COOKIE = 'ek_click';
export const TOUCH_MAX_AGE_SEC = 90 * 24 * 3600;

const MAX = 150;
const clean = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim().slice(0, MAX);
  return s ? s : null;
};

export interface ClickIds {
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  fbclid: string | null;
  /** Epoch ms the fbclid was seen (for the `_fbc` format). */
  fbclidAt: number | null;
}

/**
 * A touch from a landing URL, or null when the URL carries no campaign data and the referrer is our own site
 * (internal navigation never overwrites the last touch).
 */
export function touchFromUrl(url: URL, referrer: string | null, now: number): { touch: Touch | null; clicks: Partial<ClickIds> } {
  const q = url.searchParams;
  let referrerHost: string | null = null;
  try {
    referrerHost = referrer ? new URL(referrer).hostname.toLowerCase() : null;
  } catch {
    referrerHost = null;
  }
  if (referrerHost === url.hostname.toLowerCase()) referrerHost = null;
  const clicks: Partial<ClickIds> = {};
  for (const key of ['gclid', 'gbraid', 'wbraid', 'fbclid'] as const) {
    const v = clean(q.get(key));
    if (v && /^[A-Za-z0-9_.-]+$/.test(v)) clicks[key] = v;
  }
  if (clicks.fbclid) clicks.fbclidAt = now;
  const touch: Touch = {
    source: clean(q.get('utm_source')),
    medium: clean(q.get('utm_medium')),
    campaign: clean(q.get('utm_campaign')),
    term: clean(q.get('utm_term')),
    content: clean(q.get('utm_content')),
    referrerHost,
    landingPath: url.pathname.slice(0, 300),
    at: now,
  };
  if (!touch.source && !touch.medium && !touch.campaign && !referrerHost && !Object.keys(clicks).length) return { touch: null, clicks };
  if (!touch.source && clicks.gclid) Object.assign(touch, { source: 'google', medium: 'cpc' });
  if (!touch.source && clicks.fbclid) Object.assign(touch, { source: 'facebook', medium: 'paid_social' });
  if (!touch.source && referrerHost) Object.assign(touch, { source: referrerHost, medium: 'referral' });
  return { touch, clicks };
}

export const encodeJsonCookie = (v: unknown): string => encodeURIComponent(JSON.stringify(v));

export function decodeJsonCookie<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(decodeURIComponent(raw)) as unknown;
    return v && typeof v === 'object' ? (v as T) : null;
  } catch {
    return null;
  }
}

/** Meta `_fbc` value built from an fbclid: `fb.1.<epoch ms>.<fbclid>`. */
export const fbcFrom = (fbclid: string, atMs: number): string => `fb.1.${Math.floor(atMs)}.${fbclid}`;

/** GA4 client id from the `_ga` cookie (`GA1.1.123456.789` -> `123456.789`). */
export function gaClientId(gaCookie: string | null | undefined): string | null {
  const m = /^GA\d\.\d+\.(\d+\.\d+)$/.exec(gaCookie ?? '');
  return m ? m[1]! : null;
}

/** Touch from a cookie, validated field by field (cookies are client-controlled). */
export function sanitiseTouch(raw: unknown): Touch | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const s = (k: string) => (typeof r[k] === 'string' ? clean(r[k] as string) : null);
  const at = typeof r.at === 'number' && Number.isFinite(r.at) ? r.at : 0;
  return { source: s('source'), medium: s('medium'), campaign: s('campaign'), term: s('term'), content: s('content'), referrerHost: s('referrerHost'), landingPath: s('landingPath'), at };
}

export function sanitiseClicks(raw: unknown): ClickIds {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const id = (k: string) => (typeof r[k] === 'string' && /^[A-Za-z0-9_.-]{1,150}$/.test(r[k] as string) ? (r[k] as string) : null);
  return { gclid: id('gclid'), gbraid: id('gbraid'), wbraid: id('wbraid'), fbclid: id('fbclid'), fbclidAt: typeof r.fbclidAt === 'number' ? r.fbclidAt : null };
}
