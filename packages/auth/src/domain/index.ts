// Pure auth rules: roles, lifetimes, limits, input schemas. No React, Next or database.
import { PERMISSIONS, ROLE_PERMISSIONS, STAFF_ROLES, type Permission, type StaffRole } from '@ecomkit/core/contracts';
import { normalisePhone } from '@ecomkit/core/ids';
import { z } from 'zod';

export { PERMISSIONS, ROLE_PERMISSIONS, STAFF_ROLES, type Permission, type StaffRole };

export const CUSTOMER_ROLE = 'customer';

export const OTP_LENGTH = 6;
export const OTP_TTL_SEC = 300;
/** Wrong codes allowed per challenge before it is burnt. */
export const OTP_MAX_ATTEMPTS = 3;
export const CUSTOMER_SESSION_SEC = 30 * 24 * 3600;
/** Absolute: a staff session ends 12 h after sign-in however active it is. */
export const STAFF_SESSION_SEC = 12 * 3600;
export const STAFF_INVITE_TTL_SEC = 72 * 3600;
export const STAFF_PASSWORD_MIN = 12;
export const STAFF_PASSWORD_MAX = 128;
export const LOCKOUT_FAILURES = 5;
export const LOCKOUT_SEC = 15 * 60;

/** Rate limits (BUILD-PLAN section 8). Keys are `<routeId>:<subject>`. */
export const RATE_LIMITS = {
  otpSendPerIdentifier: { route: 'otp-send', limit: 3, windowSec: 600 },
  otpSendPerIp: { route: 'otp-send-ip', limit: 10, windowSec: 3600 },
  otpVerify: { route: 'otp-verify', limit: 5, windowSec: 600 },
  staffLoginPerIp: { route: 'staff-login', limit: 10, windowSec: 900 },
} as const;

/** Paths that may create a staff session: password sign-in, the second factor and enrolment rotation. Never OTP. */
export const STAFF_SESSION_PATHS: readonly string[] = [
  '/sign-in/email',
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
  '/two-factor/enable',
  '/two-factor/disable',
];

/** The only Better Auth endpoints reachable over HTTP; every other flow runs through this package's server functions. */
export const PUBLIC_AUTH_PATHS: readonly string[] = ['/get-session', '/sign-out', '/ok'];

export function isStaffRole(role: string | null | undefined): role is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(role ?? '');
}

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/** Owner always holds every permission (cannot be locked out by an edit); other roles come from the stored matrix. */
export function effectivePermissions(role: StaffRole, stored: readonly string[]): Permission[] {
  if (role === 'owner') return [...PERMISSIONS];
  return PERMISSIONS.filter((p) => stored.includes(p));
}

const PLACEHOLDER_DOMAIN = 'phone.invalid';

/** Better Auth needs an email on every user; phone-only customers get `<digits>@phone.invalid` (RFC 2606 reserved TLD). */
export function placeholderEmail(phoneE164: string): string {
  return `${phoneE164.replace(/\D/g, '')}@${PLACEHOLDER_DOMAIN}`;
}

export function isPlaceholderEmail(email: string | null | undefined): boolean {
  return !!email && email.endsWith(`@${PLACEHOLDER_DOMAIN}`);
}

export type Identifier = { kind: 'phone' | 'email'; value: string };

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

/** One login field takes a phone number (-> E.164 +91) or an email (-> trimmed lowercase); anything else is null. */
export function parseIdentifier(input: unknown): Identifier | null {
  if (typeof input !== 'string') return null;
  if (input.includes('@')) {
    const email = emailSchema.safeParse(input);
    return email.success ? { kind: 'email', value: email.data } : null;
  }
  const phone = normalisePhone(input.trim());
  return phone ? { kind: 'phone', value: phone } : null;
}

export const otpCodeSchema = z.string().trim().regex(new RegExp(`^\\d{${OTP_LENGTH}}$`));
export const totpCodeSchema = z.string().trim().regex(/^\d{6}$/);
/** Better Auth backup codes are 10 characters, shown as `xxxxx-xxxxx`. */
export const backupCodeSchema = z.string().trim().min(10).max(11);

export const staffPasswordSchema = z.string().min(STAFF_PASSWORD_MIN).max(STAFF_PASSWORD_MAX);
export const staffRoleSchema = z.enum(STAFF_ROLES);

export const inviteStaffSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(1).max(120),
  role: staffRoleSchema,
});
export type InviteStaffInput = z.infer<typeof inviteStaffSchema>;

/** A relative in-site path for post-login redirects; anything else (absolute, protocol-relative) falls back. */
export function safeNextPath(next: unknown, fallback: string): string {
  // Browsers strip tabs/newlines and treat backslashes as slashes, so reject them anywhere, then require
  // that resolving against a dummy origin stays on that origin.
  if (typeof next !== 'string' || !next.startsWith('/')) return fallback;
  for (const ch of next) {
    const code = ch.charCodeAt(0);
    if (ch === '\\' || code < 32 || code === 127) return fallback;
  }
  const base = 'http://same.invalid';
  let url: URL;
  try {
    url = new URL(next, base);
  } catch {
    return fallback;
  }
  return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : fallback;
}
