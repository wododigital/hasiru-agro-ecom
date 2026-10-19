import { ForbiddenError, NotFoundError, setAuthProvider } from '@ecomkit/core/auth-context';
import { ROLE_PERMISSIONS, type StaffRole, type StaffViewer, type Viewer } from '@ecomkit/core/contracts';
import type { ReactNode } from 'react';
import { prerender } from 'react-dom/static';

let current: Viewer = { kind: 'guest' };

/** Binds a fake `auth` service whose viewer the test sets with `actAs`. */
export function installFakeAuth(): void {
  setAuthProvider(async () => ({
    getViewer: async () => current,
    requirePermission: async (p) => {
      if (current.kind === 'staff' && current.permissions.includes(p)) return current;
      throw new ForbiddenError();
    },
    requireOwner: async () => {
      throw new NotFoundError();
    },
  }));
}

export function actAs(viewer: Viewer): void {
  current = viewer;
}

export function staff(role: StaffRole): StaffViewer {
  return { kind: 'staff', userId: `00000000-0000-7000-8000-00000000000${STAFF_INDEX[role]}`, name: `Test ${role}`, email: `${role}@example.com`, role, permissions: ROLE_PERMISSIONS[role] };
}
const STAFF_INDEX: Record<StaffRole, number> = { owner: 1, manager: 2, catalog_editor: 3, fulfilment: 4, support: 5 };

export const guest: Viewer = { kind: 'guest' };
export const customer: Viewer = { kind: 'customer', userId: 'c1', customerId: 'c1', name: 'A buyer', phone: null, email: null };

/** Renders a server tree (async components included) to HTML; errors thrown inside Suspense are collected. */
export async function render(node: ReactNode): Promise<{ html: string; errors: unknown[] }> {
  const errors: unknown[] = [];
  const { prelude } = await prerender(node, { onError: (e) => void errors.push(e) });
  const html = await new Response(prelude).text();
  return { html, errors };
}

export const isNotFound = (e: unknown) => typeof (e as { digest?: unknown })?.digest === 'string' && (e as { digest: string }).digest.startsWith('NEXT_HTTP_ERROR_FALLBACK;404');
