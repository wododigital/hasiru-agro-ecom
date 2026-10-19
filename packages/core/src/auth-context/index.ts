import { cache } from 'react';
import type { AuthContext, CustomerViewer, Permission, StaffViewer, Viewer } from '../contracts';

export type { AuthContext, CustomerViewer, StaffViewer, Viewer } from '../contracts';

/** Maps to HTTP 403. Thrown when a staff viewer lacks a permission (or the viewer is not staff). */
export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = 'forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/** Maps to HTTP 404. Thrown on ownership failures so an id's existence never leaks. */
export class NotFoundError extends Error {
  readonly status = 404;
  constructor(message = 'not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

type Provider = () => Promise<AuthContext | null>;
let provider: Provider = async () => null;

/**
 * The app binds the auth implementation once at boot, normally `() => registry.service('auth')`.
 * With no provider (auth module disabled) everyone is a guest and every permission check fails closed.
 */
export function setAuthProvider(next: Provider): void {
  provider = next;
}

const GUEST: Viewer = { kind: 'guest' };

/** The current viewer, resolved once per request (React `cache`). */
export const getViewer = cache(async (): Promise<Viewer> => {
  const auth = await provider();
  return auth ? auth.getViewer() : GUEST;
});

export async function requirePermission(permission: Permission): Promise<StaffViewer> {
  const auth = await provider();
  if (!auth) throw new ForbiddenError();
  return auth.requirePermission(permission);
}

export async function requireOwner(customerId: string): Promise<CustomerViewer> {
  const auth = await provider();
  if (!auth) throw new NotFoundError();
  return auth.requireOwner(customerId);
}

/** Pure check for UI decisions (hide a button); enforcement still goes through requirePermission. */
export function can(viewer: Viewer, permission: Permission): boolean {
  return viewer.kind === 'staff' && viewer.permissions.includes(permission);
}
