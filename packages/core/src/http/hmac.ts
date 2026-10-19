import { createHmac, timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';
import { derivedSecret } from './secrets';

/** Constant-time string compare. Different lengths return false without leaking where they differ. */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    nodeTimingSafeEqual(ab, ab); // same work either way
    return false;
  }
  return nodeTimingSafeEqual(ab, bb);
}

/**
 * Verifies an HMAC-SHA256 signature over the raw body. Accepts hex (optionally `sha256=` prefixed, as
 * Meta sends it) or base64. Always pass the raw bytes, never re-serialised JSON.
 */
export function verifyHmacSha256(raw: string | Buffer, signature: string | null | undefined, secret: string | Buffer): boolean {
  if (!signature || !secret.length) return false;
  const sig = signature.trim().replace(/^sha256=/i, '');
  const mac = createHmac('sha256', secret).update(raw).digest();
  return timingSafeEqual(sig.toLowerCase(), mac.toString('hex')) || timingSafeEqual(sig, mac.toString('base64'));
}

/** Hex HMAC-SHA256 (outgoing webhooks, partner APIs). */
export function signHmacSha256(raw: string | Buffer, secret: string | Buffer): string {
  return createHmac('sha256', secret).update(raw).digest('hex');
}

/** Signs with the internal key derived for `purpose` (see derivedSecret). */
export function signInternal(raw: string | Buffer, purpose: string): string {
  return signHmacSha256(raw, derivedSecret(purpose));
}

export function verifyInternal(raw: string | Buffer, signature: string | null | undefined, purpose: string): boolean {
  return verifyHmacSha256(raw, signature, derivedSecret(purpose));
}
