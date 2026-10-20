import { NAV_BANDS } from '@ecomkit/core/contracts';
import { defineModule } from '@ecomkit/core/manifest';
import { ordersSettingsSchema } from './domain';

/**
 * Orders: line snapshots, status machine, timeline, gapless numbers, GST invoices, customer and guest order pages,
 * admin orders with saved views, dispatch planner, manual and replacement orders. Payments, inventory, discounts and
 * catalog are reached through `configureOrders` ports and are optional.
 */
export default defineModule({
  id: 'orders',
  dependsOn: ['core', 'customers'],
  optional: ['payments', 'inventory', 'discounts', 'catalog', 'shipping', 'notifications'],
  schema: () => import('./schema'),
  routes: [
    { path: '/account/orders', module: 'routes/account-orders', kind: 'page', exports: ['default', 'generateMetadata'] },
    { path: '/account/orders/[id]', module: 'routes/account-order', kind: 'page', exports: ['default', 'generateMetadata'] },
    { path: '/account/orders/[id]/invoice.pdf', module: 'routes/account-order-invoice', kind: 'route', exports: ['GET'] },
    { path: '/order/[token]', module: 'routes/order-token', kind: 'page', exports: ['default', 'generateMetadata'] },
    { path: '/order/[token]/invoice.pdf', module: 'routes/order-token-invoice', kind: 'route', exports: ['GET'] },
    { path: '/admin/orders/[id]/invoice.pdf', module: 'routes/admin-order-invoice', kind: 'route', exports: ['GET'] },
  ],
  admin: {
    nav: [
      { label: 'Orders', href: '/admin/orders', icon: 'shopping-bag', order: NAV_BANDS.orders, permission: 'orders.read' },
      { label: 'Dispatch planner', href: '/admin/orders/dispatch', icon: 'truck', order: NAV_BANDS.orders + 10, permission: 'orders.dispatch' },
    ],
    pages: [
      { path: '/admin/orders', module: 'routes/admin-orders', kind: 'page', exports: ['default', 'generateMetadata'] },
      { path: '/admin/orders/new', module: 'routes/admin-order-new', kind: 'page', exports: ['default', 'generateMetadata'] },
      { path: '/admin/orders/dispatch', module: 'routes/admin-dispatch', kind: 'page', exports: ['default', 'generateMetadata'] },
      { path: '/admin/orders/[id]', module: 'routes/admin-order', kind: 'page', exports: ['default', 'generateMetadata'] },
    ],
  },
  settings: { schema: ordersSettingsSchema },
  permissions: ['orders.read', 'orders.write', 'orders.refund', 'orders.dispatch'],
  emits: [
    'order.placed',
    'order.paid',
    'order.payment_failed',
    'order.confirmed',
    'order.packed',
    'order.dispatched',
    'order.delivered',
    'order.cancelled',
    'order.refunded',
    'order.replacement_created',
  ],
  on: { 'order.paid': () => import('./server/invoice').then((m) => m.onOrderPaid) },
});
