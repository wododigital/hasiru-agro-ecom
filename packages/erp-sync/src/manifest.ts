import { NAV_BANDS } from '@ecomkit/core/contracts';
import { defineModule } from '@ecomkit/core/manifest';
import { erpSyncSettingsSchema } from './domain';

const server = () => import('./server');
const admin = () => import('./admin/pages');

/**
 * ERP sync: outbox for orders and leads (retry, backoff, dead letter), scheduled inventory pull into
 * inventory.setFromErp (manual overrides win, A26), variant <-> ERP item mapping, sync log, drift report.
 * The adapter (transport) comes from an adapter module through `configureErpSync` (see README).
 * Orders, customers and catalog are optional: their data arrives through ports bound by the host.
 */
export default defineModule({
  id: 'erp-sync',
  dependsOn: ['core', 'inventory'],
  optional: ['orders', 'customers', 'catalog'],
  schema: () => import('./schema'),
  routes: [{ path: '/api/admin/erp/pending-orders', module: 'routes/pending-orders-csv', kind: 'route', exports: ['GET'] }],
  admin: {
    nav: [{ label: 'ERP sync', href: '/admin/erp', icon: 'refresh-cw', order: NAV_BANDS.health + 30, permission: 'health.read' }],
    pages: [{ path: '/admin/erp', module: 'routes/admin-erp', kind: 'page', exports: ['default', 'generateMetadata'] }],
  },
  settings: {
    schema: erpSyncSettingsSchema,
    actions: [
      { id: 'sync-now', label: 'Sync stock now', kind: 'server-action', permission: 'inventory.write', run: () => server().then((m) => m.syncNowAction) },
      { id: 'push-now', label: 'Push outbox now', kind: 'server-action', permission: 'jobs.retry', run: () => server().then((m) => m.pushNowAction) },
    ],
    customPanel: () => admin().then((m) => m.MappingPanel),
  },
  permissions: ['inventory.read', 'inventory.write', 'health.read', 'jobs.retry', 'orders.write'],
  jobs: {
    'erp-sync.pull-inventory': { handler: () => server().then((m) => m.pullInventoryJob), options: { policy: 'singleton', retryLimit: 0, expireInSec: 600 } },
    'erp-sync.push-outbox': { handler: () => server().then((m) => m.pushOutboxJob), options: { policy: 'singleton', retryLimit: 0, expireInSec: 600 } },
  },
  schedules: [
    // Runs every minute and skips itself until settings.pullEveryMinutes has passed, so the interval is admin-editable.
    { job: 'erp-sync.pull-inventory', cron: '* * * * *' },
    { job: 'erp-sync.push-outbox', cron: '* * * * *' },
  ],
  emits: ['erp.synced'],
  on: {
    'order.paid': () => server().then((m) => m.onOrderPaid),
    'order.confirmed': () => server().then((m) => m.onOrderConfirmed),
    'lead.created': () => server().then((m) => m.onLeadCreated),
  },
  dashboardWidgets: [{ id: 'erp-sync.waiting-orders', title: 'Orders waiting for ops sync', order: 60, size: 'sm', permission: 'orders.read', component: () => admin().then((m) => m.WaitingOrdersTile) }],
  reports: [
    {
      id: 'erp-sync.drift',
      title: 'Stock drift vs ERP',
      group: 'inventory',
      permission: 'inventory.read',
      component: () => admin().then((m) => m.DriftReportView),
      csv: () => server().then((m) => () => m.driftCsvRows()),
    },
  ],
  healthChecks: [
    { id: 'erp-sync.pull-age', label: 'ERP stock pull', critical: false, readiness: false, run: () => server().then((m) => () => m.pullAgeHealth()) },
    { id: 'erp-sync.dead-letter', label: 'ERP outbox dead letter', critical: true, readiness: false, run: () => server().then((m) => m.outboxHealth) },
  ],
});
