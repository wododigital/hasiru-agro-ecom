import { defineModule } from '@ecomkit/core/manifest';
import { cartSettingsSchema } from './domain';

/**
 * Cart: cookie-keyed DB cart, product and package lines with weights, merge on sign-in, totals preview through
 * core.computeTotals, cart blocks, abandoned-cart events and restore links. Discounts, inventory and shipping
 * are optional: without them there is no coupon field, no stock notes and no delivery chooser.
 */
export default defineModule({
  id: 'cart',
  dependsOn: ['core', 'ui', 'catalog', 'pricing'],
  optional: ['inventory', 'discounts', 'shipping'],
  schema: () => import('./schema'),
  routes: [
    { path: '/cart', module: 'routes/cart-page', kind: 'page', exports: ['default', 'generateMetadata'] },
    { path: '/api/cart', module: 'routes/api-cart', kind: 'route', exports: ['GET'] },
    { path: '/api/cart/lines', module: 'routes/api-cart-lines', kind: 'route', exports: ['POST'] },
    { path: '/api/cart/restore', module: 'routes/api-cart-restore', kind: 'route', exports: ['GET', 'POST'] },
  ],
  settings: { schema: cartSettingsSchema },
  jobs: {
    'cart.mark-abandoned': {
      handler: () => import('./server/jobs').then((m) => m.markAbandonedJob),
      options: { policy: 'singleton', retryLimit: 2, expireInSec: 240 },
    },
  },
  schedules: [{ job: 'cart.mark-abandoned', cron: '*/5 * * * *' }],
  emits: ['cart.updated', 'cart.abandoned'],
});
