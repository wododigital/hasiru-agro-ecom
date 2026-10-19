import { db } from '@ecomkit/core/db';
import { emit } from '@ecomkit/core/events';
import { derivedSecret } from '@ecomkit/core/http';
import { newId, normalisePhone } from '@ecomkit/core/ids';
import { captureError } from '@ecomkit/core/observability';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { admin } from 'better-auth/plugins/admin';
import { adminAc, userAc } from 'better-auth/plugins/admin/access';
import { emailOTP } from 'better-auth/plugins/email-otp';
import { phoneNumber } from 'better-auth/plugins/phone-number';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { eq } from 'drizzle-orm';
import {
  CUSTOMER_ROLE,
  CUSTOMER_SESSION_SEC,
  LOCKOUT_FAILURES,
  LOCKOUT_SEC,
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_SEC,
  STAFF_PASSWORD_MAX,
  STAFF_PASSWORD_MIN,
  STAFF_SESSION_PATHS,
  STAFF_ROLES,
  STAFF_SESSION_SEC,
  isStaffRole,
  placeholderEmail,
} from '../domain';
import { authAccount, authSession, authTwoFactor, authUser, authVerification } from '../schema';
import { consumePhoneCode, hashCode } from './codes';
import { authDeps, baseURL, cachedInstance } from './config';
import { deliver } from './delivery';

/** Drizzle tables under Better Auth's default model names, so no modelName mapping is needed. */
export const authTables = { user: authUser, session: authSession, account: authAccount, verification: authVerification, twoFactor: authTwoFactor };

/** The Better Auth options (exported for the schema drift test). */
export function authOptions() {
  return {
    appName: authDeps().appName ?? 'Store',
    baseURL: baseURL(),
    secret: derivedSecret('better-auth').toString('base64url'),
    database: drizzleAdapter(db, { provider: 'pg', schema: authTables }),
    telemetry: { enabled: false },
    // Limits live in this package's server functions (core rateLimit); over HTTP only PUBLIC_AUTH_PATHS are reachable.
    rateLimit: { enabled: false },
    // Staff only: invite-only, so self sign-up is off. Customers never have a password.
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: STAFF_PASSWORD_MIN, maxPasswordLength: STAFF_PASSWORD_MAX },
    session: { expiresIn: CUSTOMER_SESSION_SEC, updateAge: 24 * 3600 },
    advanced: {
      cookiePrefix: 'ek',
      ipAddress: { ipAddressHeaders: ['x-real-ip', 'x-forwarded-for'] },
      database: { generateId: () => newId() },
    },
    databaseHooks: {
      session: {
        create: {
          // Staff sessions only come from password + second factor, and live 12 h. A false return blocks the session.
          before: async (session, ctx) => {
            const [user] = await db.select({ role: authUser.role }).from(authUser).where(eq(authUser.id, session.userId));
            if (!user || !isStaffRole(user.role)) return;
            if (!ctx?.path || !STAFF_SESSION_PATHS.includes(ctx.path)) return false;
            return { data: { ...session, expiresAt: new Date(Date.now() + STAFF_SESSION_SEC * 1000) } };
          },
        },
      },
      user: {
        create: {
          after: async (user) => {
            if (isStaffRole((user as { role?: string }).role)) return;
            try {
              await emit('customer.created', { customerId: user.id });
            } catch (err) {
              await captureError(err, { route: 'auth.user-created' });
            }
          },
        },
      },
    },
    plugins: [
      phoneNumber({
        otpLength: OTP_LENGTH,
        expiresIn: OTP_TTL_SEC,
        allowedAttempts: OTP_MAX_ATTEMPTS,
        phoneNumberValidator: (p) => normalisePhone(p) === p,
        // Codes are issued by sendOtp() (hashed storage); the plugin's own send route is not exposed.
        sendOTP: () => {
          throw new Error('phone codes are issued by sendOtp()');
        },
        verifyOTP: ({ phoneNumber: phone, code }) => consumePhoneCode(phone, code),
        signUpOnVerification: { getTempEmail: placeholderEmail, getTempName: () => '' },
      }),
      emailOTP({
        otpLength: OTP_LENGTH,
        expiresIn: OTP_TTL_SEC,
        allowedAttempts: OTP_MAX_ATTEMPTS,
        storeOTP: { hash: async (otp) => hashCode(otp) },
        sendVerificationOTP: async ({ email, otp }) => deliver('otp.login', { email }, { code: otp }),
      }),
      twoFactor({
        issuer: authDeps().appName ?? 'Store',
        accountLockout: { enabled: true, maxFailedAttempts: LOCKOUT_FAILURES, durationSeconds: LOCKOUT_SEC },
      }),
      // Supplies role/ban fields and blocks banned users at sign-in. Its HTTP endpoints are not exposed; staff management
      // goes through staff.ts with the stored permission matrix. Only `owner` maps to its admin access role.
      admin({
        defaultRole: CUSTOMER_ROLE,
        adminRoles: ['owner'],
        roles: Object.fromEntries([...STAFF_ROLES, CUSTOMER_ROLE].map((role) => [role, role === 'owner' ? adminAc : userAc])),
      }),
      // Must stay last: writes Set-Cookie through next/headers inside server actions.
      nextCookies(),
    ],
  } satisfies BetterAuthOptions;
}

function build() {
  return betterAuth(authOptions());
}

export type Auth = ReturnType<typeof build>;

/** The Better Auth instance (built on first use, rebuilt after `configureAuth`). */
export function getAuth(): Auth {
  return cachedInstance(build);
}
