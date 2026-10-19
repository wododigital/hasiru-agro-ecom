import { NAV_BANDS } from '@ecomkit/core/contracts';
import { defineModule } from '@ecomkit/core/manifest';

/**
 * Media: uploads, the sharp pipeline, the library, signed private files. No settings: the storage root is
 * deploy config (MEDIA_ROOT). Other modules link files through `trackUsage` and render through `getImages`.
 */
export default defineModule({
  id: 'media',
  dependsOn: ['core'],
  schema: () => import('./schema'),
  routes: [
    { path: '/api/media/upload', module: 'routes/upload', kind: 'route', exports: ['POST'] },
    { path: '/media/[...path]', module: 'routes/media-file', kind: 'route', exports: ['GET'] },
  ],
  admin: {
    nav: [{ label: 'Media', href: '/admin/media', icon: 'image', order: NAV_BANDS.products + 40, permission: 'media.write' }],
    pages: [
      { path: '/admin/media', module: 'routes/admin-library', kind: 'page', exports: ['default', 'generateMetadata'] },
      { path: '/admin/media/[id]', module: 'routes/admin-asset', kind: 'page', exports: ['default', 'generateMetadata'] },
    ],
  },
  permissions: ['media.write'],
  jobs: {
    'media.warm': { handler: () => import('./server/jobs').then((m) => m.warmJob), options: { policy: 'standard' } },
  },
  // Sweep for uploads whose queue write was lost.
  schedules: [{ job: 'media.warm', cron: '*/15 * * * *' }],
  healthChecks: [
    { id: 'media-storage', label: 'Media storage writable', critical: false, readiness: true, run: () => import('./server/jobs').then((m) => m.storageHealth) },
  ],
  seedHooks: [{ id: 'import-masters', order: 0, run: () => import('./server/seed').then((m) => m.importMasters) }],
});
