import { tags } from '@ecomkit/core/cache-tags';
import { NAV_BANDS } from '@ecomkit/core/contracts';
import { defineModule } from '@ecomkit/core/manifest';
import { searchSettingsSchema } from './settings';

/**
 * Search and facets: /search (trgm over the catalog), /api/search/suggest and /facets.json (static
 * index, client-side filtering), the zero-result log and the Search insights admin page.
 * Off: listings render without filters; nothing else depends on it.
 */
export default defineModule({
  id: 'search',
  dependsOn: ['core', 'ui', 'catalog'],
  optional: ['pricing', 'inventory', 'places', 'admin-shell'],
  schema: () => import('./schema'),
  routes: [
    { path: '/search', module: 'routes/search-page', kind: 'page', exports: ['default', 'generateMetadata'] },
    { path: '/api/search/suggest', module: 'routes/suggest', kind: 'route', exports: ['GET'] },
    { path: '/api/search/log', module: 'routes/log', kind: 'route', exports: ['POST'] },
    { path: '/facets.json', module: 'routes/facets', kind: 'route', exports: ['GET'] },
  ],
  admin: {
    nav: [{ label: 'Search insights', href: '/admin/search', icon: 'search', order: NAV_BANDS.analytics + 40, permission: 'analytics.read' }],
    pages: [{ path: '/admin/search', module: 'routes/admin-insights', kind: 'page', exports: ['default', 'generateMetadata'] }],
  },
  settings: { schema: searchSettingsSchema },
  permissions: ['analytics.read'],
  cacheTags: [tags.catalog],
});
