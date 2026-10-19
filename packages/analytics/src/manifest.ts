import { NAV_BANDS } from '@ecomkit/core/contracts';
import { defineModule } from '@ecomkit/core/manifest';

/**
 * First-party analytics: the /b.js collector, the /api/beacon-ingest endpoint, sessions, monthly-partitioned raw
 * events (90 days), nightly rollups and the Analytics admin page. Optional: customers (consent for identity
 * linking, wired by the host), orders and others (Sales, Products, Customers tabs via the `reports` point).
 */
export default defineModule({
  id: 'analytics',
  dependsOn: ['core', 'ui'],
  optional: ['customers', 'orders'],
  schema: () => import('./schema'),
  routes: [
    { path: '/b.js', module: 'routes/beacon-script', kind: 'route', exports: ['GET'] },
    { path: '/api/beacon-ingest', module: 'routes/beacon-ingest', kind: 'route', exports: ['POST'] },
  ],
  admin: {
    nav: [{ label: 'Analytics', href: '/admin/analytics', icon: 'chart-line', order: NAV_BANDS.analytics, permission: 'analytics.read' }],
    pages: [{ path: '/admin/analytics', module: 'routes/admin-analytics', kind: 'page', exports: ['default'] }],
  },
  permissions: ['analytics.read'],
  jobs: {
    'analytics.create-partition': { handler: () => import('./server/partitions').then((m) => m.createPartitionJob), options: { policy: 'singleton' } },
    'analytics.rollup-daily': { handler: () => import('./server/rollup').then((m) => m.rollupDailyJob), options: { policy: 'singleton' } },
  },
  schedules: [
    { job: 'analytics.create-partition', cron: '0 2 25 * *' },
    { job: 'analytics.rollup-daily', cron: '30 1 * * *' },
  ],
  on: {
    'consent.changed': () => import('./server/consent').then((m) => m.onConsentChanged),
  },
});
