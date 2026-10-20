import { defineModule } from '@ecomkit/core/manifest';
import { shippingSettingsSchema } from './settings';

/**
 * Shipping: zones, pickup / local slot / outstation methods, vehicles and trips, slot calendar with cutoff and
 * capacity, packing rules, distance overrides, delivery promise. Provides the `shipping` service (shipping-method
 * contract). Delivery settings: the generated form plus the Delivery panel (rows) as `customPanel`.
 */
export default defineModule({
  id: 'shipping',
  dependsOn: ['core'],
  optional: ['places'],
  schema: () => import('./schema'),
  routes: [{ path: '/api/delivery-check', module: 'routes/delivery-check', kind: 'route', exports: ['GET'] }],
  settings: {
    schema: shippingSettingsSchema,
    customPanel: () => import('./admin/DeliveryPanel').then((m) => m.DeliveryPanel),
  },
  pdpSections: [{ id: 'shipping.delivery-check', order: 50, slot: 'aside', component: () => import('./ui/DeliveryCheckSection').then((m) => m.DeliveryCheckSection) }],
  permissions: ['settings.read', 'settings.write'],
  jobs: {
    'shipping.slot-reminders': {
      handler: () => import('./server/jobs').then((m) => m.slotRemindersJob),
      options: { policy: 'singleton', retryLimit: 3, expireInSec: 300 },
    },
  },
  // Hourly 08:00 to 20:00 IST: a booking made late on the day before still gets its reminder; each order once.
  schedules: [{ job: 'shipping.slot-reminders', cron: '0 8-20 * * *' }],
  emits: ['slot.reminder'],
  on: {
    'order.cancelled': () => import('./server/jobs').then((m) => m.onOrderCancelled),
    'order.payment_failed': () => import('./server/jobs').then((m) => m.onPaymentFailed),
  },
  provides: { shipping: () => import('./server/quote').then((m) => m.shippingQuoter) },
  seedHooks: [{ id: 'shipping.setup', order: 10, run: () => import('./server/seed').then((m) => m.seedHook) }],
});
