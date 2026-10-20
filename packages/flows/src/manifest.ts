import { NAV_BANDS } from '@ecomkit/core/contracts';
import { defineModule } from '@ecomkit/core/manifest';

const events = () => import('./server/events');

/**
 * Fixed automation flows (abandoned cart, order updates, slot reminder, review request, back in stock, planner lead
 * follow-up): per-flow settings form, runs. The cart restore link in reminders is the cart module's (single use,
 * signed); flows only asks for it. Cart, orders, discounts and catalog are reached
 * through boot-time ports (`configureFlows`); a flow whose source is absent starts no messages.
 */
export default defineModule({
  id: 'flows',
  dependsOn: ['core', 'notifications', 'customers'],
  optional: ['cart', 'orders', 'discounts', 'shipping', 'inventory', 'catalog'],
  schema: () => import('./schema'),
  routes: [],
  admin: {
    nav: [
      { label: 'Automations', href: '/admin/marketing/automations', icon: 'workflow', order: NAV_BANDS.marketing + 10, permission: 'marketing.write' },
      { label: 'Abandoned checkouts', href: '/admin/abandoned-checkouts', icon: 'shopping-cart', order: NAV_BANDS.orders + 40, permission: 'orders.read' },
    ],
    pages: [
      { path: '/admin/marketing/automations', module: 'routes/admin-automations', kind: 'page', exports: ['default', 'generateMetadata'] },
      { path: '/admin/marketing/automations/[key]', module: 'routes/admin-automation', kind: 'page', exports: ['default', 'generateMetadata'] },
      { path: '/admin/abandoned-checkouts', module: 'routes/admin-abandoned-checkouts', kind: 'page', exports: ['default', 'generateMetadata'] },
    ],
  },
  permissions: ['marketing.write', 'orders.read'],
  jobs: {
    'flows.run-due': { handler: () => import('./server/runner').then((m) => m.runDueJob), options: { policy: 'singleton', retryLimit: 2, expireInSec: 50 } },
  },
  schedules: [{ job: 'flows.run-due', cron: '* * * * *' }],
  on: {
    'cart.abandoned': () => events().then((m) => m.onCartAbandoned),
    'order.placed': () => events().then((m) => m.onOrderPlaced),
    'order.paid': () => events().then((m) => m.onOrderConfirmed),
    'order.confirmed': () => events().then((m) => m.onOrderConfirmed),
    'order.packed': () => events().then((m) => m.onOrderPacked),
    'order.dispatched': () => events().then((m) => m.onOrderDispatched),
    'order.delivered': () => events().then((m) => m.onOrderDelivered),
    'slot.reminder': () => events().then((m) => m.onSlotReminder),
    'lead.created': () => events().then((m) => m.onLeadCreated),
  },
});
