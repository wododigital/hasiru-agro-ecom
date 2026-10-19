import type { RouteDef } from '../contracts';

/** App-relative file a route stub is written to (posix separators). */
export function routeFilePath(route: Pick<RouteDef, 'path' | 'kind'>): string {
  const segments = route.path === '/' ? '' : route.path;
  if (route.kind === 'route') return `app${segments}/route.ts`;
  const group = route.path === '/admin' || route.path.startsWith('/admin/') ? '(admin)' : '(shop)';
  return `app/${group}${segments}/page.tsx`;
}
