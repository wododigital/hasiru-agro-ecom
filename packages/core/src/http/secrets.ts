import { createHmac } from 'node:crypto';

/**
 * One server secret (INTERNAL_SECRET), a separate derived key per purpose, so a token signed for one
 * use (form time trap) can never verify for another (internal revalidate).
 */
export function derivedSecret(purpose: string): Buffer {
  const root = process.env.INTERNAL_SECRET;
  if (!root || root.length < 32) throw new Error('INTERNAL_SECRET is not set (32+ characters)');
  return createHmac('sha256', root).update(`ecomkit:${purpose}`).digest();
}

/** Salted, non-reversible IP for audit rows, rate-limit subjects and analytics. */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return createHmac('sha256', derivedSecret('ip-hash')).update(ip.trim()).digest('base64url').slice(0, 22);
}
