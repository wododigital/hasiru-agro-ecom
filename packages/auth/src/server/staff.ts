import { randomBytes } from 'node:crypto';
import { audit } from '@ecomkit/core/audit';
import type { Permission, StaffRole } from '@ecomkit/core/contracts';
import { db } from '@ecomkit/core/db';
import { hashIp, signInternal } from '@ecomkit/core/http';
import { captureError } from '@ecomkit/core/observability';
import { rateLimit } from '@ecomkit/core/rate-limit';
import { isAPIError } from 'better-auth/api';
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import {
  LOCKOUT_FAILURES,
  LOCKOUT_SEC,
  RATE_LIMITS,
  ROLE_PERMISSIONS,
  STAFF_INVITE_TTL_SEC,
  STAFF_ROLES,
  backupCodeSchema,
  effectivePermissions,
  emailSchema,
  inviteStaffSchema,
  isPermission,
  isStaffRole,
  staffPasswordSchema,
  staffRoleSchema,
  totpCodeSchema,
  type InviteStaffInput,
} from '../domain';
import { authAccount, authRolePermission, authSession, authUser, authVerification } from '../schema';
import { getAuth } from './auth';
import { baseURL } from './config';
import { deliver } from './delivery';
import { requirePermission } from './viewer';

export type StaffSignInResult =
  | { status: 'two_factor'; headers: Headers }
  | { status: 'enrol'; headers: Headers }
  | { status: 'invalid' }
  | { status: 'locked'; retryAfterSec: number }
  | { status: 'rate_limited'; retryAfterSec: number };

const secondsUntil = (d: Date, now: Date) => Math.max(1, Math.ceil((d.getTime() - now.getTime()) / 1000));

// ---- invites ---------------------------------------------------------------

const inviteKey = (token: string) => `staff-invite:${signInternal(token, 'auth-invite')}`;

async function issueInvite(user: { id: string; email: string; name: string; role: StaffRole }, actorId: string | null): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.delete(authVerification).where(eq(authVerification.value, `invite:${user.id}`));
  await db.insert(authVerification).values({
    identifier: inviteKey(token),
    value: `invite:${user.id}`,
    expiresAt: new Date(Date.now() + STAFF_INVITE_TTL_SEC * 1000),
  });
  const link = `${baseURL()}/admin/login?invite=${token}`;
  // The link is also returned (CLI prints it, the admin can copy it), so a mail outage never blocks onboarding.
  await deliver('staff.invite', { email: user.email }, { name: user.name, role: user.role, link }).catch((err: unknown) => captureError(err, { route: 'auth.staff-invite' }));
  await audit({ actorId, actorType: actorId ? 'staff' : 'system', action: 'staff.invite', entity: 'auth_user', entityId: user.id, after: { email: user.email, role: user.role } });
  return link;
}

/** Owner or anyone with staff.manage: creates the account (no password yet) and sends a 72 h invite link. */
export async function inviteStaff(input: InviteStaffInput): Promise<{ userId: string; link: string }> {
  const actor = await requirePermission('staff.manage');
  const data = inviteStaffSchema.parse(input);
  const [existing] = await db.select().from(authUser).where(eq(authUser.email, data.email));
  if (existing && !isStaffRole(existing.role)) throw new Error('email belongs to a customer account');
  const [user] = existing
    ? await db.update(authUser).set({ role: data.role, name: data.name, updatedAt: new Date() }).where(eq(authUser.id, existing.id)).returning()
    : await db.insert(authUser).values({ email: data.email, name: data.name, role: data.role }).returning();
  const link = await issueInvite({ id: user!.id, email: user!.email, name: user!.name, role: data.role }, actor.userId);
  return { userId: user!.id, link };
}

/**
 * First owner of a new store (no staff exists yet). Run from the CLI (`scripts/bootstrap-owner.ts`);
 * refuses once any owner exists, so it can never be used to take over a running store.
 */
export async function bootstrapOwner(input: { email: string; name: string }): Promise<{ userId: string; link: string }> {
  const email = emailSchema.parse(input.email);
  const [owner] = await db.select({ id: authUser.id }).from(authUser).where(eq(authUser.role, 'owner')).limit(1);
  if (owner) throw new Error('an owner already exists; invite staff from the admin');
  const [user] = await db.insert(authUser).values({ email, name: input.name.trim(), role: 'owner' }).returning();
  const link = await issueInvite({ id: user!.id, email, name: user!.name, role: 'owner' }, null);
  return { userId: user!.id, link };
}

/** Sets the password from an invite link. Every failure (unknown, expired, used, weak) is `invalid`. */
export async function acceptInvite(input: { token: string; password: string }): Promise<{ status: 'ok' | 'invalid' }> {
  const password = staffPasswordSchema.safeParse(input.password);
  if (!password.success || typeof input.token !== 'string' || input.token.length < 20) return { status: 'invalid' };
  const [row] = await db
    .select()
    .from(authVerification)
    .where(and(eq(authVerification.identifier, inviteKey(input.token)), gt(authVerification.expiresAt, new Date())));
  const userId = row?.value.startsWith('invite:') ? row.value.slice('invite:'.length) : null;
  if (!row || !userId) return { status: 'invalid' };
  const ctx = await getAuth().$context;
  const hash = await ctx.password.hash(password.data);
  await db.transaction(async (tx) => {
    await tx.delete(authVerification).where(eq(authVerification.id, row.id));
    await tx.delete(authAccount).where(and(eq(authAccount.userId, userId), eq(authAccount.providerId, 'credential')));
    await tx.insert(authAccount).values({ userId, accountId: userId, providerId: 'credential', password: hash });
    await tx.update(authUser).set({ emailVerified: true, updatedAt: new Date() }).where(eq(authUser.id, userId));
    await tx.delete(authSession).where(eq(authSession.userId, userId));
    await audit({ actorId: userId, actorType: 'staff', action: 'staff.accept-invite', entity: 'auth_user', entityId: userId }, { tx });
  });
  return { status: 'ok' };
}

// ---- password sign-in with lockout --------------------------------------------

const lockKey = (email: string) => `staff-lockout:${email}`;

async function lockedUntil(email: string, now: Date): Promise<Date | null> {
  const [row] = await db.select().from(authVerification).where(eq(authVerification.identifier, lockKey(email)));
  return row && Number(row.value) >= LOCKOUT_FAILURES && row.expiresAt > now ? row.expiresAt : null;
}

/** Counts failures per email (existing or not, so a lock never reveals an account); the 5th locks for 15 min. */
async function recordFailure(email: string, now: Date): Promise<void> {
  const [row] = await db.select().from(authVerification).where(eq(authVerification.identifier, lockKey(email)));
  const count = row && row.expiresAt > now ? Number(row.value) + 1 : 1;
  const expiresAt = !row || row.expiresAt <= now || count >= LOCKOUT_FAILURES ? new Date(now.getTime() + LOCKOUT_SEC * 1000) : row.expiresAt;
  if (row) await db.update(authVerification).set({ value: String(count), expiresAt, updatedAt: now }).where(eq(authVerification.id, row.id));
  else await db.insert(authVerification).values({ identifier: lockKey(email), value: String(count), expiresAt });
}

/**
 * Staff password sign-in. 10 tries per IP per 15 min; 5 failures for one email lock it for 15 min.
 * Staff with an authenticator get `two_factor` (no session until the code); staff without one get `enrol`.
 */
export async function signInStaff(input: { email: string; password: string; ip: string | null; requestHeaders: Headers; now?: Date }): Promise<StaffSignInResult> {
  const now = input.now ?? new Date();
  const email = emailSchema.safeParse(input.email);
  if (!email.success || typeof input.password !== 'string' || !input.password) return { status: 'invalid' };
  const r = RATE_LIMITS.staffLoginPerIp;
  const byIp = await rateLimit(`${r.route}:${hashIp(input.ip) ?? 'unknown'}`, { limit: r.limit, windowSec: r.windowSec, now });
  if (!byIp.ok) return { status: 'rate_limited', retryAfterSec: secondsUntil(byIp.resetAt, now) };
  const locked = await lockedUntil(email.data, now);
  if (locked) return { status: 'locked', retryAfterSec: secondsUntil(locked, now) };
  try {
    const { headers, response } = await getAuth().api.signInEmail({
      body: { email: email.data, password: input.password, rememberMe: false },
      headers: input.requestHeaders,
      returnHeaders: true,
    });
    await db.delete(authVerification).where(eq(authVerification.identifier, lockKey(email.data)));
    return 'twoFactorRedirect' in response && response.twoFactorRedirect ? { status: 'two_factor', headers } : { status: 'enrol', headers };
  } catch (err) {
    if (!isAPIError(err)) throw err;
    await recordFailure(email.data, now);
    return { status: 'invalid' };
  }
}

/** Second step: a TOTP code or one of the backup codes. Better Auth locks the account after 5 wrong codes for 15 min. */
export async function verifyStaffSecondFactor(input: { code: string; method: 'totp' | 'backup'; requestHeaders: Headers }): Promise<{ status: 'ok'; headers: Headers } | { status: 'invalid' }> {
  const api = getAuth().api;
  try {
    if (input.method === 'backup') {
      const code = backupCodeSchema.safeParse(input.code);
      if (!code.success) return { status: 'invalid' };
      const { headers } = await api.verifyBackupCode({ body: { code: code.data }, headers: input.requestHeaders, returnHeaders: true });
      return { status: 'ok', headers };
    }
    const code = totpCodeSchema.safeParse(input.code);
    if (!code.success) return { status: 'invalid' };
    const { headers } = await api.verifyTOTP({ body: { code: code.data }, headers: input.requestHeaders, returnHeaders: true });
    return { status: 'ok', headers };
  } catch (err) {
    if (isAPIError(err)) return { status: 'invalid' };
    throw err;
  }
}

/** First sign-in: creates the authenticator secret and 10 backup codes (shown once). Needs the password again. */
export async function beginTotpEnrolment(input: { password: string; requestHeaders: Headers }): Promise<
  { status: 'ok'; totpURI: string; secret: string; backupCodes: string[]; headers: Headers } | { status: 'invalid' }
> {
  try {
    // Enabling rotates the session; `headers` carries the new cookie.
    const { headers, response: res } = await getAuth().api.enableTwoFactor({
      body: { password: input.password, method: 'totp' },
      headers: input.requestHeaders,
      returnHeaders: true,
    });
    if (res.method !== 'totp') return { status: 'invalid' };
    const secret = new URL(res.totpURI).searchParams.get('secret') ?? '';
    return { status: 'ok', totpURI: res.totpURI, secret, backupCodes: res.backupCodes, headers };
  } catch (err) {
    if (isAPIError(err)) return { status: 'invalid' };
    throw err;
  }
}

/** Confirms enrolment with the first code from the app; from here the staff member has a working admin session. */
export async function confirmTotpEnrolment(input: { code: string; requestHeaders: Headers }): Promise<{ status: 'ok'; headers: Headers } | { status: 'invalid' }> {
  return verifyStaffSecondFactor({ code: input.code, method: 'totp', requestHeaders: input.requestHeaders });
}

export async function signOut(requestHeaders: Headers): Promise<Headers> {
  try {
    const { headers } = await getAuth().api.signOut({ headers: requestHeaders, returnHeaders: true });
    return headers;
  } catch (err) {
    if (isAPIError(err)) return new Headers();
    throw err;
  }
}

// ---- staff and roles (staff.manage) -----------------------------------------

export interface StaffRow {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  twoFactorEnabled: boolean;
  disabled: boolean;
  invitePending: boolean;
  createdAt: Date;
}

export async function listStaff(): Promise<StaffRow[]> {
  await requirePermission('staff.manage');
  const rows = await db
    .select({
      id: authUser.id,
      name: authUser.name,
      email: authUser.email,
      role: authUser.role,
      twoFactorEnabled: authUser.twoFactorEnabled,
      banned: authUser.banned,
      createdAt: authUser.createdAt,
      // Raw names: drizzle renders unqualified columns in a select list, which would bind to the subquery's table.
      hasPassword: sql<boolean>`exists (select 1 from auth_account a where a.user_id = auth_user.id and a.provider_id = 'credential')`,
    })
    .from(authUser)
    .where(inArray(authUser.role, [...STAFF_ROLES]))
    .orderBy(asc(authUser.name), asc(authUser.id));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role as StaffRole,
    twoFactorEnabled: !!r.twoFactorEnabled,
    disabled: !!r.banned,
    invitePending: !r.hasPassword,
    createdAt: r.createdAt,
  }));
}

async function ownerCount(): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(authUser).where(and(eq(authUser.role, 'owner'), sql`coalesce(${authUser.banned}, false) = false`));
  return row?.n ?? 0;
}

async function staffTarget(userId: string) {
  const [user] = await db.select().from(authUser).where(eq(authUser.id, userId));
  if (!user || !isStaffRole(user.role)) throw new Error('not a staff account');
  return user;
}

/** Changes a staff role. Nobody changes their own role, and the last active owner cannot be demoted. */
export async function setStaffRole(userId: string, role: StaffRole): Promise<void> {
  const actor = await requirePermission('staff.manage');
  const next = staffRoleSchema.parse(role);
  const user = await staffTarget(userId);
  if (user.id === actor.userId) throw new Error('you cannot change your own role');
  if (user.role === 'owner' && next !== 'owner' && (await ownerCount()) <= 1) throw new Error('the last owner cannot be demoted');
  await db.update(authUser).set({ role: next, updatedAt: new Date() }).where(eq(authUser.id, userId));
  await audit({ actorId: actor.userId, actorType: 'staff', action: 'staff.role', entity: 'auth_user', entityId: userId, before: { role: user.role }, after: { role: next } });
}

/** Disables (signs out everywhere, blocks sign-in) or re-enables a staff account. Never yourself or the last owner. */
export async function setStaffDisabled(userId: string, disabled: boolean): Promise<void> {
  const actor = await requirePermission('staff.manage');
  const user = await staffTarget(userId);
  if (user.id === actor.userId) throw new Error('you cannot disable yourself');
  if (disabled && user.role === 'owner' && (await ownerCount()) <= 1) throw new Error('the last owner cannot be disabled');
  await db.transaction(async (tx) => {
    await tx.update(authUser).set({ banned: disabled, banReason: disabled ? 'disabled by staff' : null, updatedAt: new Date() }).where(eq(authUser.id, userId));
    if (disabled) await tx.delete(authSession).where(eq(authSession.userId, userId));
    await audit({ actorId: actor.userId, actorType: 'staff', action: disabled ? 'staff.disable' : 'staff.enable', entity: 'auth_user', entityId: userId }, { tx });
  });
}

/** Resends an invite (new link, old one stops working). */
export async function resendInvite(userId: string): Promise<{ link: string }> {
  const actor = await requirePermission('staff.manage');
  const user = await staffTarget(userId);
  return { link: await issueInvite({ id: user.id, email: user.email, name: user.name, role: user.role as StaffRole }, actor.userId) };
}

export async function getRoleMatrix(): Promise<Record<StaffRole, Permission[]>> {
  await requirePermission('staff.manage');
  const rows = await db.select().from(authRolePermission);
  return Object.fromEntries(
    STAFF_ROLES.map((role) => [
      role,
      effectivePermissions(
        role,
        rows.filter((r) => r.role === role).map((r) => r.permission),
      ),
    ]),
  ) as Record<StaffRole, Permission[]>;
}

/** Replaces one role's permissions. `owner` always has everything and is not editable. */
export async function setRolePermissions(role: StaffRole, permissions: readonly string[]): Promise<void> {
  const actor = await requirePermission('staff.manage');
  const target = staffRoleSchema.parse(role);
  if (target === 'owner') throw new Error('owner permissions are fixed');
  const next = [...new Set(permissions)];
  const unknown = next.filter((p) => !isPermission(p));
  if (unknown.length) throw new Error(`unknown permissions: ${unknown.join(', ')}`);
  await db.transaction(async (tx) => {
    const before = await tx.select({ p: authRolePermission.permission }).from(authRolePermission).where(eq(authRolePermission.role, target));
    await tx.delete(authRolePermission).where(eq(authRolePermission.role, target));
    if (next.length) await tx.insert(authRolePermission).values(next.map((permission) => ({ role: target, permission })));
    await audit(
      { actorId: actor.userId, actorType: 'staff', action: 'role.permissions', entity: 'auth_role_permission', entityId: target, before: before.map((r) => r.p).sort(), after: [...next].sort() },
      { tx },
    );
  });
}

/** Seeds the default matrix for every role that has no rows yet; a role an owner has edited is left alone. */
export async function ensureRolePermissions(options: { dryRun?: boolean } = {}): Promise<number> {
  const existing = await db.selectDistinct({ role: authRolePermission.role }).from(authRolePermission);
  const seeded = new Set(existing.map((r) => r.role));
  const rows = STAFF_ROLES.filter((role) => role !== 'owner' && !seeded.has(role)).flatMap((role) =>
    ROLE_PERMISSIONS[role].map((permission) => ({ role, permission })),
  );
  if (rows.length && !options.dryRun) await db.insert(authRolePermission).values(rows).onConflictDoNothing();
  return rows.length;
}
