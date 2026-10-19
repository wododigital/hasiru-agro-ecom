import { db } from '@ecomkit/core/db';
import { hashIp } from '@ecomkit/core/http';
import { captureError } from '@ecomkit/core/observability';
import { rateLimit, type RateLimitResult } from '@ecomkit/core/rate-limit';
import { isAPIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import { RATE_LIMITS, isStaffRole, otpCodeSchema, parseIdentifier, type Identifier } from '../domain';
import { authUser } from '../schema';
import { getAuth } from './auth';
import { generateCode, storePhoneCode } from './codes';
import { deliver } from './delivery';

export type SendOtpResult = { status: 'sent' } | { status: 'invalid' } | { status: 'rate_limited'; retryAfterSec: number };
export type VerifyOtpResult =
  | { status: 'ok'; userId: string; headers: Headers }
  | { status: 'invalid' }
  | { status: 'rate_limited'; retryAfterSec: number };

const limited = (r: RateLimitResult, now: Date) => ({ status: 'rate_limited' as const, retryAfterSec: Math.max(1, Math.ceil((r.resetAt.getTime() - now.getTime()) / 1000)) });

async function hit(rule: { route: string; limit: number; windowSec: number }, subject: string, now: Date): Promise<RateLimitResult> {
  return rateLimit(`${rule.route}:${subject}`, { limit: rule.limit, windowSec: rule.windowSec, now });
}

/** Staff never sign in with a code; their identifiers get the same answer as everyone else and no message. */
async function isStaffIdentifier(id: Identifier): Promise<boolean> {
  const rows = await db
    .select({ role: authUser.role })
    .from(authUser)
    .where(id.kind === 'phone' ? eq(authUser.phoneNumber, id.value) : eq(authUser.email, id.value));
  return rows.some((r) => isStaffRole(r.role));
}

/**
 * Issues a 6-digit sign-in code to a phone (WhatsApp authentication template via notifications) or an email.
 * The answer is the same whether or not an account exists, and whether or not delivery worked (failures are captured).
 * Limits: 3 per identifier per 10 min, 10 per IP per hour.
 */
export async function sendOtp(input: { identifier: string; ip: string | null; now?: Date }): Promise<SendOtpResult> {
  const now = input.now ?? new Date();
  const id = parseIdentifier(input.identifier);
  if (!id) return { status: 'invalid' };
  const byIp = await hit(RATE_LIMITS.otpSendPerIp, hashIp(input.ip) ?? 'unknown', now);
  if (!byIp.ok) return limited(byIp, now);
  const byId = await hit(RATE_LIMITS.otpSendPerIdentifier, id.value, now);
  if (!byId.ok) return limited(byId, now);
  if (await isStaffIdentifier(id)) return { status: 'sent' };
  try {
    if (id.kind === 'phone') {
      const code = generateCode();
      await storePhoneCode(id.value, code, now);
      await deliver('otp.login', { phone: id.value }, { code });
    } else {
      await getAuth().api.sendVerificationOTP({ body: { email: id.value, type: 'sign-in' } });
    }
  } catch (err) {
    await captureError(err, { route: 'auth.send-otp' });
  }
  return { status: 'sent' };
}

/**
 * Checks a code and signs the customer in (creating the account on first use). Wrong, expired, burnt and never-issued
 * codes all return the same `invalid`. Limit: 5 checks per identifier per 10 min, on top of 3 attempts per code.
 * `headers` carries the Set-Cookie for the new session (server actions apply it automatically).
 */
export async function verifyOtp(input: { identifier: string; code: string; requestHeaders: Headers; now?: Date }): Promise<VerifyOtpResult> {
  const now = input.now ?? new Date();
  const id = parseIdentifier(input.identifier);
  const code = otpCodeSchema.safeParse(input.code);
  if (!id || !code.success) return { status: 'invalid' };
  const limit = await hit(RATE_LIMITS.otpVerify, id.value, now);
  if (!limit.ok) return limited(limit, now);
  const api = getAuth().api;
  try {
    const { headers, response } =
      id.kind === 'phone'
        ? await api.verifyPhoneNumber({ body: { phoneNumber: id.value, code: code.data }, headers: input.requestHeaders, returnHeaders: true })
        : await api.signInEmailOTP({ body: { email: id.value, otp: code.data }, headers: input.requestHeaders, returnHeaders: true });
    if (!response.user) return { status: 'invalid' };
    return { status: 'ok', userId: response.user.id, headers };
  } catch (err) {
    if (isAPIError(err)) return { status: 'invalid' };
    throw err;
  }
}
