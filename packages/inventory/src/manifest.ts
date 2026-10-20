import { NAV_BANDS } from '@ecomkit/core/contracts';
import { defineModule } from '@ecomkit/core/manifest';
import { inventorySettingsSchema } from './domain';

/**
 * Inventory: levels per variant, reservations with a TTL, movements ledger, ERP override rule (A26),
 * back-in-stock subscriptions. Provides the `inventory` service (inventory-ops contract).
 */
export default defineModule({
  id: 'inventory',
  dependsOn: ['core', 'catalog'],
  schema: () => import('./schema'),
  routes: [{ path: '/api/notify-me', module: 'routes/notify-me', kind: 'route', exports: ['POST'] }],
  admin: {
    nav: [{ label: 'Inventory', href: '/admin/inventory', icon: 'boxes', order: NAV_BANDS.products + 30, permission: 'inventory.read' }],
    pages: [
      { path: '/admin/inventory', module: 'routes/admin-inventory', kind: 'page', exports: ['default', 'generateMetadata'] },
      { path: '/admin/inventory/[variantId]', module: 'routes/admin-inventory-variant', kind: 'page', exports: ['default', 'generateMetadata'] },
    ],
  },
  settings: { schema: inventorySettingsSchema },
  productFormTabs: [
    { id: 'inventory', label: 'Inventory', order: 30, permission: 'inventory.read', component: () => import('./admin/InventoryTab').then((m) => m.InventoryTab) },
  ],
  pdpSections: [{ id: 'inventory.notify-me', order: 40, slot: 'aside', component: () => import('./ui/NotifyMeSection').then((m) => m.NotifyMeSection) }],
  // Home "Things to do" (read structurally by admin-shell).
  adminTodos: [{ id: 'inventory.low', label: 'variants low on stock', href: '/admin/inventory?state=low', order: 50, permission: 'inventory.read', count: () => import('./admin/todos').then((m) => m.lowStock) }],
  permissions: ['inventory.read', 'inventory.write'],
  jobs: {
    'inventory.release-expired': {
      handler: () => import('./server/jobs').then((m) => m.releaseExpiredJob),
      options: { policy: 'singleton', retryLimit: 2, expireInSec: 50 },
    },
  },
  schedules: [{ job: 'inventory.release-expired', cron: '* * * * *' }],
  emits: ['stock.changed', 'stock.low'],
  on: { 'stock.changed': () => import('./server/subscriptions').then((m) => m.onStockChanged) },
  cacheTags: ['stock:<id>'],
  provides: { inventory: () => import('./server/ops').then((m) => m.inventoryOps) },
  seedHooks: [{ id: 'inventory.levels', order: 10, run: () => import('./server/seed').then((m) => m.seedHook) }],
});
