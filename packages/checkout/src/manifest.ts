import { defineModule } from '@ecomkit/core/manifest';
import { checkoutSettingsSchema } from './domain';

/**
 * Checkout: one-page checkout (contact autosave, address with pincode autofill, delivery with dates, COD modes),
 * server quote through `core.computeTotals`, idempotent place-order. Cart, orders and payments are reached
 * through `configureCheckout` ports; shipping, inventory and discounts are optional.
 */
export default defineModule({
  id: 'checkout',
  dependsOn: ['core', 'cart', 'auth', 'customers', 'orders'],
  optional: ['payments', 'shipping', 'discounts', 'inventory', 'places', 'marketing'],
  schema: () => import('./schema'),
  routes: [
    { path: '/checkout', module: 'routes/checkout', kind: 'page', exports: ['default', 'generateMetadata'] },
    { path: '/checkout/[orderId]/pay', module: 'routes/checkout-pay', kind: 'page', exports: ['default', 'generateMetadata'] },
  ],
  settings: { schema: checkoutSettingsSchema },
  emits: ['checkout.started', 'checkout.contact_saved'],
});
