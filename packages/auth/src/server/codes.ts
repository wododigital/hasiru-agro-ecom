import { randomInt } from 'node:crypto';
import { db } from '@ecomkit/core/db';
import { signInternal, timingSafeEqual } from '@ecomkit/core/http';
import { and, eq, gt, sql } from 'drizzle-orm';
import { OTP_LENGTH, OTP_MAX_ATTEMPTS, OTP_TTL_SEC } from '../domain';
import { authVerification } from '../schema';

/** Keyed hash of a one-time code (HMAC with a derived server key), so a database leak does not reveal live codes. */
export const hashCode = (code: string): string => signInternal(code, 'auth-otp');

export function generateCode(): string {
  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
}

const phoneKey = (phone: string) => `phone-otp:${phone}`;

/** Replaces any open challenge for the phone with a new one. Stored as `<hash>:<attempts>`. */
export async function storePhoneCode(phone: string, code: string, now = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(authVerification).where(eq(authVerification.identifier, phoneKey(phone)));
    await tx.insert(authVerification).values({
      identifier: phoneKey(phone),
      value: `${hashCode(code)}:0`,
      expiresAt: new Date(now.getTime() + OTP_TTL_SEC * 1000),
    });
  });
}

/**
 * Checks and consumes a phone code. Every check spends one attempt first (one atomic UPDATE), so parallel
 * guesses cannot exceed the limit. A correct code or a spent challenge deletes the row.
 */
export async function consumePhoneCode(phone: string, code: string): Promise<boolean> {
  const [row] = await db
    .update(authVerification)
    .set({ value: sql`split_part(${authVerification.value}, ':', 1) || ':' || (split_part(${authVerification.value}, ':', 2)::int + 1)` })
    .where(and(eq(authVerification.identifier, phoneKey(phone)), gt(authVerification.expiresAt, new Date())))
    .returning({ id: authVerification.id, value: authVerification.value });
  if (!row) return false;
  const [hash = '', attempts = '0'] = row.value.split(':');
  const used = Number(attempts);
  const ok = used <= OTP_MAX_ATTEMPTS && timingSafeEqual(hash, hashCode(code));
  if (ok || used >= OTP_MAX_ATTEMPTS) await db.delete(authVerification).where(eq(authVerification.id, row.id));
  return ok;
}
