import { NAV_BANDS } from '@ecomkit/core/contracts';
import { defineModule } from '@ecomkit/core/manifest';
import { monitoringSettingsSchema } from './domain';

const page = (path: string, module: string) => ({ path, module, kind: 'page' as const, exports: ['default', 'generateMetadata'] as const });

/**
 * Monitoring: health endpoints and checks, alert issues with dedupe, repeats, digests and a webhook fallback,
 * and the Health screens (overview, alerts, errors, jobs, logs). Notifications is optional: without it alerts go
 * to the webhook and the admin bell.
 */
export default defineModule({
  id: 'monitoring',
  dependsOn: ['core'],
  optional: ['notifications', 'seo'],
  schema: () => import('./schema'),
  routes: [
    { path: '/api/health/live', module: 'routes/health-live', kind: 'route', exports: ['GET'] },
    { path: '/api/health/ready', module: 'routes/health-ready', kind: 'route', exports: ['GET'] },
  ],
  admin: {
    nav: [{ label: 'Health', href: '/admin/health', icon: 'activity', order: NAV_BANDS.health, permission: 'health.read' }],
    pages: [
      page('/admin/health', 'routes/admin-health'),
      page('/admin/health/alerts', 'routes/admin-health-alerts'),
      page('/admin/health/errors', 'routes/admin-health-errors'),
      page('/admin/health/errors/[id]', 'routes/admin-health-error'),
      page('/admin/health/jobs', 'routes/admin-health-jobs'),
      page('/admin/health/logs', 'routes/admin-health-logs'),
    ],
  },
  settings: {
    schema: monitoringSettingsSchema,
    actions: [
      {
        id: 'monitoring.test-alert',
        label: 'Send test alert',
        kind: 'test-connection',
        run: () => import('./server/alerts').then((m) => m.sendTestAlert),
      },
    ],
  },
  // Home "Things to do" (read structurally by admin-shell).
  adminTodos: [{ id: 'monitoring.alerts', label: 'open alerts', href: '/admin/health/alerts', order: 60, permission: 'health.read', count: () => import('./admin/todos').then((m) => m.openAlerts) }],
  permissions: ['health.read', 'jobs.retry'],
  jobs: {
    'monitoring.tick': {
      handler: () => import('./server/jobs').then((m) => m.tickJob),
      options: { policy: 'singleton', retryLimit: 0, expireInSec: 55, deadLetter: false },
    },
    'monitoring.digest-high': { handler: () => import('./server/jobs').then((m) => m.digestHighJob), options: { policy: 'singleton', retryLimit: 2 } },
    'monitoring.digest-low': { handler: () => import('./server/jobs').then((m) => m.digestLowJob), options: { policy: 'singleton', retryLimit: 2 } },
    'monitoring.daily': { handler: () => import('./server/jobs').then((m) => m.dailyJob), options: { policy: 'singleton', retryLimit: 1, expireInSec: 600 } },
  },
  schedules: [
    { job: 'monitoring.tick', cron: '* * * * *' },
    { job: 'monitoring.digest-high', cron: '0 * * * *' },
    { job: 'monitoring.digest-low', cron: '0 9 * * *' },
    { job: 'monitoring.daily', cron: '40 2 * * *' },
  ],
  emits: ['alert.raised'],
  on: { 'integration.failed': () => import('./server/scans').then((m) => m.onIntegrationFailed) },
  dashboardWidgets: [
    {
      id: 'monitoring.alerts',
      title: 'Open alerts',
      order: 10,
      size: 'sm',
      permission: 'health.read',
      component: () => import('./admin/AlertsWidget').then((m) => m.AlertsWidget),
    },
  ],
});
