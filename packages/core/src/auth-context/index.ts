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
 * Marks the render as request-time before any cookie or session read, so a page that checks the viewer is never
 * prerendered at build (cache components would otherwise bake a guest or a ForbiddenError into static output).
 * Next's own control-flow errors carry a digest and must propagate; anything else means "not inside Next".
 */
async function atRequestTime(): Promise<void> {
  try {
    await (await import('next/server')).connection();
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'digest' in err) throw err;
  }
}

async function currentProvider(): Promise<AuthContext | null> {
  await atRequestTime();
  return provider();
}

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
  const auth = await currentProvider();
  return auth ? auth.getViewer() : GUEST;
});

export async function requirePermission(permission: Permission): Promise<StaffViewer> {
  const auth = await currentProvider();
  if (!auth) throw new ForbiddenError();
  return auth.requirePermission(permission);
}

export async function requireOwner(customerId: string): Promise<CustomerViewer> {
  const auth = await currentProvider();
  if (!auth) throw new NotFoundError();
  return auth.requireOwner(customerId);
}

/** Pure check for UI decisions (hide a button); enforcement still goes through requirePermission. */
export function can(viewer: Viewer, permission: Permission): boolean {
  return viewer.kind === 'staff' && viewer.permissions.includes(permission);
}
