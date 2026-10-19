import { ForbiddenError, NotFoundError } from '@ecomkit/core/auth-context';
import type { AuthContext, CustomerViewer, Permission, StaffViewer, Viewer } from '@ecomkit/core/contracts';
import { db } from '@ecomkit/core/db';
import { eq } from 'drizzle-orm';
import { cache } from 'react';
import { STAFF_SESSION_SEC, effectivePermissions, isPlaceholderEmail, isStaffRole } from '../domain';
import { authRolePermission, authSession } from '../schema';
import { getAuth } from './auth';
import { requestHeaders } from './config';

const GUEST: Viewer = { kind: 'guest' };

type SessionUser = {
  id: string;
  name: string;
  email: string;
  role?: string | null;
  banned?: boolean | null;
  banExpires?: Date | null;
  phoneNumber?: string | null;
  twoFactorEnabled?: boolean | null;
};

export type StaffGate =
  | { state: 'anonymous' }
  /** Signed in with a password but no authenticator yet: may only enrol. */
  | { state: 'enrol'; email: string }
  | { state: 'ready'; viewer: StaffViewer }
  | { state: 'not_staff' };

function isBanned(user: SessionUser, now: Date): boolean {
  if (!user.banned) return false;
  return !user.banExpires || user.banExpires.getTime() > now.getTime();
}

async function sessionFor(headers: Headers) {
  const result = await getAuth().api.getSession({ headers });
  return result ? { session: result.session, user: result.user as SessionUser } : null;
}

/**
 * Resolves who is asking. Checked on every request: banned or disabled accounts, staff without a second factor
 * (guest until enrolled), staff sessions older than 12 h (deleted). Permissions are read fresh from the role matrix.
 */
export async function resolveViewer(headers: Headers, now = new Date()): Promise<Viewer> {
  const found = await sessionFor(headers);
  if (!found) return GUEST;
  const { session, user } = found;
  if (isBanned(user, now)) return GUEST;
  if (isStaffRole(user.role)) {
    if (!user.twoFactorEnabled) return GUEST;
    if (now.getTime() - new Date(session.createdAt).getTime() >= STAFF_SESSION_SEC * 1000) {
      await db.delete(authSession).where(eq(authSession.id, session.id));
      return GUEST;
    }
    const rows = await db.select({ permission: authRolePermission.permission }).from(authRolePermission).where(eq(authRolePermission.role, user.role));
    return {
      kind: 'staff',
      userId: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      permissions: effectivePermissions(
        user.role,
        rows.map((r) => r.permission),
      ),
    };
  }
  return {
    kind: 'customer',
    userId: user.id,
    // One account, one customer: the customers module keys its profile by this id.
    customerId: user.id,
    name: user.name || null,
    phone: user.phoneNumber ?? null,
    email: isPlaceholderEmail(user.email) ? null : user.email,
  };
}

/** Staff sign-in state for /admin/login (the only place that sees a not-yet-enrolled staff session). */
export async function staffGate(headers: Headers, now = new Date()): Promise<StaffGate> {
  const found = await sessionFor(headers);
  if (!found || isBanned(found.user, now)) return { state: 'anonymous' };
  if (!isStaffRole(found.user.role)) return { state: 'not_staff' };
  if (!found.user.twoFactorEnabled) return { state: 'enrol', email: found.user.email };
  const viewer = await resolveViewer(headers, now);
  return viewer.kind === 'staff' ? { state: 'ready', viewer } : { state: 'anonymous' };
}

/** Once per request (React cache); outside a request (tests, scripts) every call resolves afresh. */
export const getViewer = cache(async (): Promise<Viewer> => resolveViewer(await requestHeaders()));

export async function requirePermission(permission: Permission): Promise<StaffViewer> {
  const viewer = await getViewer();
  if (viewer.kind === 'staff' && viewer.permissions.includes(permission)) return viewer;
  throw new ForbiddenError();
}

export async function requireOwner(customerId: string): Promise<CustomerViewer> {
  const viewer = await getViewer();
  if (viewer.kind === 'customer' && viewer.customerId === customerId) return viewer;
  throw new NotFoundError();
}

/** Any staff member, or a 404 (the admin never admits it exists to anyone else). */
export async function requireStaff(): Promise<StaffViewer> {
  const viewer = await getViewer();
  if (viewer.kind === 'staff') return viewer;
  throw new NotFoundError();
}

/** The `auth` service (manifest `provides.auth`), bound into core with `setAuthProvider`. */
export const authContext: AuthContext = { getViewer, requirePermission, requireOwner };
