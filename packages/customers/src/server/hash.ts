import { createHmac } from 'node:crypto';
import { derivedSecret } from '@ecomkit/core/http';
import { normalisePhone } from '@ecomkit/core/ids';

/**
 * Keyed, non-reversible hash of a phone or email for matching and search (the plain value is stored
 * alongside for display). Phones are normalised to E.164 first and emails lowercased, so every spelling
 * of the same contact hashes the same.
 */
export function hashContact(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  const key = v.includes('@') ? v.toLowerCase() : (normalisePhone(v) ?? v);
  return createHmac('sha256', derivedSecret('contact-hash')).update(key).digest('base64url').slice(0, 22);
}
