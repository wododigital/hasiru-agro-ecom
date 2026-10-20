// HMAC request signing shared by the outbound client, the status webhook route and the mock operations app.
import { randomBytes } from 'node:crypto';
import { derivedSecret, signHmacSha256, verifyHmacSha256 } from '@ecomkit/core/http';
import { NONCE_RE, SIGNATURE_MAX_SKEW_SEC, SIGNED_HEADERS, signingString } from '../domain';

/** Secret the mock operations app and mock-mode clients share (derived from INTERNAL_SECRET, never configured). */
export const mockSecret = (): Buffer => derivedSecret('hasiru-ops-mock');

export function signRequest(input: { method: string; path: string; body: string; secret: string | Buffer; now?: Date }): Record<string, string> {
  const timestamp = String(Math.floor((input.now ?? new Date()).getTime() / 1000));
  const nonce = randomBytes(18).toString('base64url');
  const signature = signHmacSha256(signingString({ timestamp, nonce, method: input.method, path: input.path, body: input.body }), input.secret);
  return { [SIGNED_HEADERS.timestamp]: timestamp, [SIGNED_HEADERS.nonce]: nonce, [SIGNED_HEADERS.signature]: signature };
}

export type VerifyResult = { ok: true; nonce: string } | { ok: false; reason: 'missing' | 'stale' | 'bad_signature' };

/** Checks headers, the 5-minute timestamp window and the signature. Nonce dedupe is the caller's job (it needs storage). */
export function verifyRequest(input: { method: string; path: string; body: string; headers: Headers; secret: string | Buffer; now?: Date }): VerifyResult {
  const ts = input.headers.get(SIGNED_HEADERS.timestamp) ?? '';
  const nonce = input.headers.get(SIGNED_HEADERS.nonce) ?? '';
  const sig = input.headers.get(SIGNED_HEADERS.signature);
  if (!/^\d{9,11}$/.test(ts) || !NONCE_RE.test(nonce) || !sig) return { ok: false, reason: 'missing' };
  const skew = Math.abs((input.now ?? new Date()).getTime() / 1000 - Number(ts));
  if (skew > SIGNATURE_MAX_SKEW_SEC) return { ok: false, reason: 'stale' };
  const ok = verifyHmacSha256(signingString({ timestamp: ts, nonce, method: input.method, path: input.path, body: input.body }), sig, input.secret);
  return ok ? { ok: true, nonce } : { ok: false, reason: 'bad_signature' };
}
