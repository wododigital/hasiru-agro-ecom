import { getViewer } from '@ecomkit/core/auth-context';
import type { Permission, StaffViewer } from '@ecomkit/core/contracts';
import { hashIp } from '@ecomkit/core/http';
import { captureError } from '@ecomkit/core/observability';
import { notFound } from 'next/navigation';
import { ZodError } from 'zod';
import type { FormState } from '../domain';

export const NO_ACCESS = 'You do not have access to do this.';

/** Next's own control-flow errors (notFound, redirect, prerender bailouts) carry a digest and must propagate. */
const isNextInternal = (err: unknown) => typeof err === 'object' && err !== null && 'digest' in err;

/** Request path (from the proxy's `x-pathname` header) and hashed client IP. Empty outside a request (tests, scripts). */
export async function requestMeta(): Promise<{ pathname: string | null; ipHash: string | null }> {
  try {
    const { headers } = await import('next/headers');
    const h = await headers();
    return { pathname: h.get('x-pathname'), ipHash: hashIp(h.get('x-real-ip')) };
  } catch (err) {
    if (isNextInternal(err)) throw err;
    return { pathname: null, ipHash: null };
  }
}

/** Marks the render as request-time before the clock or the database is read (cache components). No-op outside Next. */
async function atRequestTime(): Promise<void> {
  try {
    await (await import('next/server')).connection();
  } catch (err) {
    if (isNextInternal(err)) throw err;
  }
}

export type AdminAccess = { state: 'ok' | 'forbidden'; viewer: StaffViewer };

/**
 * Guard for every admin page: anyone who is not staff gets a 404 (the admin never admits it exists);
 * staff without the permission get the `forbidden` state, which the page renders as a no-access notice.
 */
export async function requireAdmin(permission?: Permission): Promise<AdminAccess> {
  await atRequestTime();
  const viewer = await getViewer();
  if (viewer.kind !== 'staff') notFound();
  return { state: permission && !viewer.permissions.includes(permission) ? 'forbidden' : 'ok', viewer };
}

/**
 * Turns a thrown error into a form result. Validation errors become field errors; a plain `Error` is a
 * business rule from a module ("the last owner cannot be demoted") and its message is shown; anything else
 * is recorded under Health > Errors and the form gets a generic message.
 */
export async function failure(err: unknown, route: string): Promise<FormState> {
  if (err instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const key = String(issue.path[0] ?? '_form');
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return { ok: false, message: 'Check the highlighted fields.', fieldErrors };
  }
  if (err instanceof Error && err.name === 'Error' && err.message) {
    return { ok: false, message: err.message.charAt(0).toUpperCase() + err.message.slice(1) };
  }
  await captureError(err, { route });
  return { ok: false, message: 'Something went wrong. It has been logged under Health.' };
}
