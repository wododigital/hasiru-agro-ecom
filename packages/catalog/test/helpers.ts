import type { AuthContext, ModuleId, ServiceKey, ServiceMap, StaffViewer, Viewer } from '@ecomkit/core/contracts';
import { ROLE_PERMISSIONS } from '@ecomkit/core/contracts';
import { ForbiddenError, setAuthProvider } from '@ecomkit/core/auth-context';
import type { CatalogRegistry } from '../src/server/runtime';

/** A registry stand-in: enabled module ids, services and extension point lists. */
export function fakeRegistry(o: { modules?: ModuleId[]; services?: Partial<ServiceMap>; lists?: Record<string, unknown[]> } = {}): CatalogRegistry {
  const mods = new Set(o.modules ?? []);
  return {
    has: (id) => mods.has(id),
    service: async <K extends ServiceKey>(key: K) => (o.services?.[key] ?? null) as ServiceMap[K] | null,
    list: ((key: string) => (o.lists?.[key] ?? []) as never) as CatalogRegistry['list'],
  };
}

export const STAFF: StaffViewer = { kind: 'staff', userId: '00000000-0000-7000-8000-00000000aaaa', name: 'Editor', email: 'editor@example.test', role: 'catalog_editor', permissions: ROLE_PERMISSIONS.catalog_editor };

/** Binds core's auth provider to a fixed viewer (guest by default). */
export function signInAs(viewer: Viewer): void {
  const auth: AuthContext = {
    getViewer: async () => viewer,
    requirePermission: async (perm) => {
      if (viewer.kind !== 'staff' || !viewer.permissions.includes(perm)) throw new ForbiddenError();
      return viewer;
    },
    requireOwner: async () => {
      throw new ForbiddenError();
    },
  };
  setAuthProvider(async () => auth);
}

/** Renders a React tree (async server components included) to HTML, waiting for every Suspense boundary. */
export async function renderHtml(node: React.ReactNode): Promise<string> {
  const { prerenderToNodeStream } = await import('react-dom/static');
  // Next's notFound / redirect throw by design; the test asserts the rejection, React need not log it.
  const { prelude } = await prerenderToNodeStream(node, { onError: (err) => void (err as { digest?: string })?.digest });
  let html = '';
  for await (const chunk of prelude) html += chunk;
  return html;
}
