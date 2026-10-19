import { defineModule } from '@ecomkit/core/manifest';
import { placesSettingsSchema } from './settings';

export default defineModule({
  id: 'places',
  dependsOn: ['core'],
  optional: ['catalog'],
  schema: () => import('./schema'),
  routes: [
    { path: '/api/places/suggest', module: 'routes/api-suggest', kind: 'route', exports: ['GET'] },
    { path: '/api/places/pincode', module: 'routes/api-pincode', kind: 'route', exports: ['GET'] },
    { path: '/api/places/nearest', module: 'routes/api-nearest', kind: 'route', exports: ['GET'] },
    { path: '/grow-in/[district]', module: 'routes/grow-in', kind: 'page', exports: ['default', 'generateMetadata', 'generateStaticParams'] },
  ],
  admin: {
    nav: [{ label: 'Districts', href: '/admin/places', icon: 'map-pin', order: 560, permission: 'content.write' }],
    pages: [{ path: '/admin/places', module: 'routes/admin-places', kind: 'page', exports: ['default'] }],
  },
  settings: { schema: placesSettingsSchema },
  permissions: ['content.write'],
  cacheTags: ['district:*'],
  provides: { places: () => import('./server/cache').then((m) => m.places) },
  sitemapSources: [{ name: 'districts', entries: () => import('./server/sitemap').then((m) => m.districtSitemapEntries) }],
  seedHooks: [{ id: 'places', order: 100, run: () => import('./server/seed').then((m) => m.runPlacesSeed) }],
});
