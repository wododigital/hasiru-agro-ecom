import { NAV_BANDS } from '@ecomkit/core/contracts';
import { defineModule } from '@ecomkit/core/manifest';
import { ordersSettingsSchema } from './domain';

const reports = () => import('./admin/reports');
const todos = () => import('./admin/todos');

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
  // Home KPI strip (ids with `.kpi.`), Analytics reports, Home "Things to do" (admin-shell reads `adminTodos` structurally).
  dashboardWidgets: [
    { id: 'orders.kpi.sales', title: 'Total sales', order: 2, size: 'sm', permission: 'analytics.read', component: () => reports().then((m) => m.SalesKpi) },
    { id: 'orders.kpi.orders', title: 'Orders', order: 3, size: 'sm', permission: 'analytics.read', component: () => reports().then((m) => m.OrdersKpi) },
    { id: 'orders.kpi.aov', title: 'Average order value', order: 5, size: 'sm', permission: 'analytics.read', component: () => reports().then((m) => m.AovKpi) },
  ],
  reports: [
    { id: 'orders.sales-over-time', title: 'Sales over time', group: 'sales', permission: 'analytics.read', component: () => reports().then((m) => m.SalesOverTimeReport) },
    { id: 'orders.average-order-value', title: 'Average order value', group: 'sales', permission: 'analytics.read', component: () => reports().then((m) => m.AovReport) },
    { id: 'orders.top-products', title: 'Top products', group: 'products', permission: 'analytics.read', component: () => reports().then((m) => m.TopProductsReport) },
    { id: 'orders.returning-customers', title: 'Returning customers', group: 'customers', permission: 'analytics.read', component: () => reports().then((m) => m.ReturningCustomersReport) },
  ],
  adminTodos: [
    { id: 'orders.dispatch', label: 'orders to dispatch', href: '/admin/orders?view=unfulfilled', order: 10, permission: 'orders.read', count: () => todos().then((m) => m.ordersToDispatch) },
    { id: 'orders.pending-payment', label: 'payments pending', href: '/admin/orders?view=pending_payment', order: 20, permission: 'orders.read', count: () => todos().then((m) => m.paymentsPending) },
  ],
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
