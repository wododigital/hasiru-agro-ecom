import type { RouteDef } from '../contracts';

/** App-relative file a route stub is written to (posix separators). */
export function routeFilePath(route: Pick<RouteDef, 'path' | 'kind'>): string {
  const segments = route.path === '/' ? '' : route.path;
  // Next treats `_`-prefixed folders as private (unrouted); `%5F` is the documented escape for a URL segment starting with `_`.
  if (route.kind === 'route') return `app${segments.replace('/api/_mock/', '/api/%5Fmock/')}/route.ts`;
  const group = route.path === '/admin' || route.path.startsWith('/admin/') ? '(admin)' : '(shop)';
  return `app/${group}${segments}/page.tsx`;
}
