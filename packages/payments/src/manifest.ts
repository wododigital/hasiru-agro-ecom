import { NAV_BANDS } from '@ecomkit/core/contracts';
import { defineModule } from '@ecomkit/core/manifest';
import { paymentsSettingsSchema } from './settings';

export default defineModule({
  id: 'payments',
  // Payments moves orders through the orders transition API (bound with configurePayments at boot).
  dependsOn: ['core', 'orders'],
  schema: () => import('./schema'),
  routes: [
    { path: '/api/webhooks/phonepe', module: 'routes/phonepe-webhook', kind: 'route', exports: ['POST'] },
    { path: '/pay/return', module: 'routes/pay-return', kind: 'page', exports: ['default', 'generateMetadata'] },
  ],
  mockRoutes: [{ path: '/api/_mock/phonepe/[...path]', module: 'mocks/phonepe', kind: 'route', exports: ['GET', 'POST'] }],
  admin: {
    nav: [{ label: 'Payments', href: '/admin/payments', icon: 'credit-card', order: NAV_BANDS.orders + 30, permission: 'orders.read' }],
    pages: [{ path: '/admin/payments', module: 'routes/admin-payments', kind: 'page', exports: ['default', 'generateMetadata'] }],
  },
  settings: {
    schema: paymentsSettingsSchema,
    actions: [{ id: 'test-connection', label: 'Test connection', kind: 'test-connection', run: () => import('./server/actions').then((m) => m.testConnectionAction) }],
  },
  permissions: ['orders.read', 'orders.write', 'orders.refund', 'settings.read', 'settings.write', 'settings.secrets'],
  jobs: {
    'payments.process-webhook': {
      handler: () => import('./server/webhook').then((m) => m.processWebhookJob),
      options: { retryLimit: 5, retryDelaySec: 30, retryBackoff: true, retryDelayMaxSec: 3600 },
    },
    'payments.poll': { handler: () => import('./server/jobs').then((m) => m.pollJob), options: { policy: 'singleton', retryLimit: 0, expireInSec: 50 } },
    'payments.sweep': { handler: () => import('./server/jobs').then((m) => m.sweepJob), options: { policy: 'singleton', retryLimit: 0, expireInSec: 50 } },
  },
  schedules: [
    { job: 'payments.poll', cron: '* * * * *' },
    { job: 'payments.sweep', cron: '* * * * *' },
  ],
  healthChecks: [
    { id: 'payments-gateway', label: 'Payment gateway', critical: false, readiness: false, run: () => import('./server/actions').then((m) => m.gatewayHealth) },
    { id: 'payments-anomalies', label: 'Payments needing attention', critical: true, readiness: false, run: () => import('./server/actions').then((m) => m.anomalyHealth) },
  ],
});
