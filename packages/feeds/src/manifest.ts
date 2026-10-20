import { NAV_BANDS } from '@ecomkit/core/contracts';
import { defineModule } from '@ecomkit/core/manifest';
import { feedsSettingsSchema } from './settings';

/**
 * Google Merchant Center XML and Meta catalog CSV as token-protected files (A24), rebuilt from catalog, pricing,
 * inventory and media after changes (debounced) and daily, rewritten only when an item's hash changed, with a
 * per-item validation report. Pushing through the Merchant API or Meta items_batch is not built (documented toggle).
 */
export default defineModule({
  id: 'feeds',
  dependsOn: ['core', 'ui', 'catalog', 'pricing', 'inventory', 'media'],
  schema: () => import('./schema'),
  routes: [
    { path: '/feeds/google.xml', module: 'routes/google-feed', kind: 'route', exports: ['GET'] },
    { path: '/feeds/meta.csv', module: 'routes/meta-feed', kind: 'route', exports: ['GET'] },
  ],
  admin: {
    nav: [{ label: 'Product feeds', href: '/admin/marketing/feeds', icon: 'rss', order: NAV_BANDS.marketing + 40, permission: 'marketing.write' }],
    pages: [{ path: '/admin/marketing/feeds', module: 'routes/admin-feeds', kind: 'page', exports: ['default', 'generateMetadata'] }],
  },
  settings: {
    schema: feedsSettingsSchema,
    actions: [
      { id: 'rebuild', label: 'Rebuild feeds now', kind: 'server-action', permission: 'marketing.write', run: () => import('./server/actions').then((m) => m.regenerateAction) },
      { id: 'rotate-token', label: 'Generate new feed token', kind: 'server-action', permission: 'settings.secrets', run: () => import('./server/actions').then((m) => m.rotateTokenAction) },
    ],
  },
  permissions: ['marketing.write', 'settings.secrets'],
  jobs: {
    'feeds.regenerate': { handler: () => import('./server/generate').then((m) => m.regenerateJob), options: { policy: 'stately', retryLimit: 3 } },
  },
  schedules: [{ job: 'feeds.regenerate', cron: '15 3 * * *', data: { force: true } }],
  on: {
    'product.updated': () => import('./server/generate').then((m) => m.onChange),
    'product.published': () => import('./server/generate').then((m) => m.onChange),
    'price.changed': () => import('./server/generate').then((m) => m.onChange),
    'stock.changed': () => import('./server/generate').then((m) => m.onChange),
  },
});
