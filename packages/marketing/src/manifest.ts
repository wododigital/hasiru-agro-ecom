import { NAV_BANDS } from '@ecomkit/core/contracts';
import { defineModule } from '@ecomkit/core/manifest';
import { marketingSettingsSchema } from './settings';

/**
 * Consent banner, tag manager (built-in GA4, Meta Pixel, Google Ads + custom tags) feeding the storefront CSP,
 * attribution on the order, and server-side purchase/refund conversions (GA4 Measurement Protocol, Meta CAPI)
 * with test-order exclusion. Optional: orders (server conversions need the host's `configureMarketing({ orders })`).
 */
export default defineModule({
  id: 'marketing',
  dependsOn: ['core', 'ui', 'customers'],
  optional: ['orders'],
  schema: () => import('./schema'),
  routes: [{ path: '/api/consent', module: 'routes/consent', kind: 'route', exports: ['POST'] }],
  mockRoutes: [
    { path: '/api/_mock/ga4/[...path]', module: 'mocks/ga4', kind: 'route', exports: ['POST'] },
    { path: '/api/_mock/meta-capi/[...path]', module: 'mocks/meta-capi', kind: 'route', exports: ['POST'] },
  ],
  admin: {
    nav: [{ label: 'Pixels & tags', href: '/admin/marketing/tags', icon: 'code', order: NAV_BANDS.marketing + 30, permission: 'marketing.write' }],
    pages: [{ path: '/admin/marketing/tags', module: 'routes/admin-tags', kind: 'page', exports: ['default', 'generateMetadata'] }],
  },
  settings: { schema: marketingSettingsSchema },
  permissions: ['marketing.write', 'settings.read', 'settings.write', 'settings.secrets'],
  on: {
    'order.paid': () => import('./server/conversions').then((m) => m.onOrderPaid),
    'order.refunded': () => import('./server/conversions').then((m) => m.onOrderRefunded),
  },
  cacheTags: ['settings:marketing'],
});
