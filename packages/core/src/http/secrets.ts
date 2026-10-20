import { createHmac } from 'node:crypto';
import { normalisePhone } from '../ids';

/**
 * One server secret (INTERNAL_SECRET), a separate derived key per purpose, so a token signed for one
 * use (form time trap) can never verify for another (internal revalidate).
 */
export function derivedSecret(purpose: string): Buffer {
  const root = process.env.INTERNAL_SECRET;
  if (!root || root.length < 32) throw new Error('INTERNAL_SECRET is not set (32+ characters)');
  return createHmac('sha256', root).update(`ecomkit:${purpose}`).digest();
}

/**
 * The client IP for rate limits and audit. Only X-Real-IP is trusted: nginx sets it from $remote_addr and
 * overwrites any client-sent value. X-Forwarded-For's first entry is client-controlled, never use it.
 * Null when there is no proxy (local dev), so callers fall back to a shared bucket. Accepts a Request or,
 * in a server component, `{ headers: await headers() }`.
 */
export function clientIp(source: { headers: { get(name: string): string | null } }): string | null {
  return source.headers.get('x-real-ip')?.trim() || null;
}

/** Salted, non-reversible IP for audit rows, rate-limit subjects and analytics. */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return createHmac('sha256', derivedSecret('ip-hash')).update(ip.trim()).digest('base64url').slice(0, 22);
}

/**
 * Keyed, non-reversible hash of a phone or email for matching, search and per-contact limits (the plain value
 * may be stored alongside for display). Phones are normalised to E.164 and emails lowercased first, so every
 * spelling of one contact hashes the same. Fails closed: an unparseable phone gets no hash (null), never a hash
 * of the raw string, or format variants would each get their own limit bucket.
 */
export function hashContact(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  const key = v.includes('@') ? v.toLowerCase() : normalisePhone(v);
  if (!key) return null;
  return createHmac('sha256', derivedSecret('contact-hash')).update(key).digest('base64url').slice(0, 22);
}
