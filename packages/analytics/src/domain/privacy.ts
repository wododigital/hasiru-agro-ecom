/** Server-side privacy pass. The collector strips the same things in the browser; this is the backstop. */

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
/** Ten or more digits, optionally with +, spaces or dashes between them (phone numbers, card-like runs). */
const PHONE_RE = /\+?\d[\d\s-]{8,}\d/g;
/** Prop keys that name personal data. Dropped whatever their value. */
const PII_KEY_RE = /(e-?mail|phone|mobile|whatsapp|address|password|otp|token|card|upi|aadhaar|pan)/i;
/** Query params kept on a path; everything else (search terms, tokens, ids) is removed. */
const KEPT_PARAM_RE = /^(utm_(source|medium|campaign|term|content)|gclid|fbclid)$/;

export type PropValue = string | number | boolean | null;

export function scrubText(value: string): string {
  return value.replace(EMAIL_RE, '[email]').replace(PHONE_RE, '[phone]');
}

export function scrubProps(props: Readonly<Record<string, PropValue>> | undefined): Record<string, PropValue> {
  const out: Record<string, PropValue> = {};
  for (const [key, value] of Object.entries(props ?? {})) {
    if (PII_KEY_RE.test(key)) continue;
    out[key] = typeof value === 'string' ? scrubText(value) : value;
  }
  return out;
}

export interface Utm {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
  /** A paid click id was present (gclid / fbclid); the id itself is not kept. */
  paid?: boolean;
}

export interface CleanPath {
  /** Pathname only, at most 300 chars. */
  path: string;
  utm: Utm | null;
}

/** Splits a collected path into the stored pathname and the campaign params. */
export function cleanPath(raw: string): CleanPath {
  let url: URL;
  try {
    url = new URL(raw, 'http://local.invalid');
  } catch {
    return { path: '/', utm: null };
  }
  const utm: Utm = {};
  for (const [key, value] of url.searchParams) {
    if (!KEPT_PARAM_RE.test(key) || !value) continue;
    if (key === 'gclid' || key === 'fbclid') utm.paid = true;
    else utm[key.slice(4) as Exclude<keyof Utm, 'paid'>] = scrubText(value).slice(0, 100).toLowerCase();
  }
  const path = scrubText(decodeSafe(url.pathname)).slice(0, 300) || '/';
  return { path, utm: Object.keys(utm).length ? utm : null };
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
