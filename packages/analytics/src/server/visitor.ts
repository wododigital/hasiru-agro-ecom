import { createHmac, randomBytes } from 'node:crypto';
import { derivedSecret } from '@ecomkit/core/http';

/** First-party, HttpOnly, set only by the ingest response. The browser script never reads or writes it. */
export const VISITOR_COOKIE = 'ek_vid';
/** 13 months. */
export const VISITOR_COOKIE_MAX_AGE = 395 * 86_400;
const COOKIE_RE = /^[A-Za-z0-9_-]{22}$/;

export function newVisitorCookie(): string {
  return randomBytes(16).toString('base64url');
}

export function isValidVisitorCookie(value: string | null | undefined): value is string {
  return !!value && COOKIE_RE.test(value);
}

/** What the database stores: an HMAC of the cookie, so a leaked table cannot be replayed as cookies. */
export function visitorHash(cookie: string): string {
  return createHmac('sha256', derivedSecret('analytics-visitor')).update(cookie).digest('base64url');
}

export function readCookie(header: string | null, name: string): string | null {
  for (const part of header?.split(';') ?? []) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

export function visitorCookieHeader(value: string, secure: boolean): string {
  return `${VISITOR_COOKIE}=${value}; Path=/; Max-Age=${VISITOR_COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}
