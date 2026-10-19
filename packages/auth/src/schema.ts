// Auth tables. The first five follow the shape Better Auth writes for this plugin set (phoneNumber, emailOTP,
// twoFactor, admin): JS property names are Better Auth field names, columns are snake_case, tables are auth_ prefixed.
// test/schema.test.ts diffs this file against Better Auth's own table list, so a plugin upgrade that adds a field fails CI.
import { newId } from '@ecomkit/core/ids';
import { boolean, index, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().$defaultFn(newId);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const authUser = pgTable(
  'auth_user',
  {
    id: id(),
    name: text('name').notNull(),
    /** Phone-only customers get a placeholder under the reserved `.invalid` TLD (domain `isPlaceholderEmail`). */
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    phoneNumber: text('phone_number').unique(),
    phoneNumberVerified: boolean('phone_number_verified'),
    /** `customer` or one of STAFF_ROLES. */
    role: text('role').notNull().default('customer'),
    banned: boolean('banned').default(false),
    banReason: text('ban_reason'),
    banExpires: timestamp('ban_expires', { withTimezone: true }),
    twoFactorEnabled: boolean('two_factor_enabled').default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('auth_user_role_idx').on(t.role), index('auth_user_list_idx').on(t.createdAt.desc(), t.id.desc())],
);

export const authSession = pgTable(
  'auth_session',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    impersonatedBy: text('impersonated_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('auth_session_user_idx').on(t.userId)],
);

export const authAccount = pgTable(
  'auth_account',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    /** scrypt hash (staff only; customers sign in with a one-time code). */
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('auth_account_user_idx').on(t.userId)],
);

/** One-time values: OTP challenges (hashed), invite tokens (hashed), lockout counters, 2FA cookies. */
export const authVerification = pgTable(
  'auth_verification',
  {
    id: id(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('auth_verification_identifier_idx').on(t.identifier)],
);

export const authTwoFactor = pgTable(
  'auth_two_factor',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    /** Encrypted by Better Auth with the auth secret. */
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    verified: boolean('verified').default(true),
    failedVerificationCount: integer('failed_verification_count').default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
  },
  (t) => [index('auth_two_factor_user_idx').on(t.userId), index('auth_two_factor_secret_idx').on(t.secret)],
);

/** Staff role matrix, seeded from ROLE_PERMISSIONS. `owner` always has every permission and is never read from here. */
export const authRolePermission = pgTable(
  'auth_role_permission',
  {
    role: text('role').notNull(),
    permission: text('permission').notNull(),
  },
  (t) => [primaryKey({ columns: [t.role, t.permission] })],
);
