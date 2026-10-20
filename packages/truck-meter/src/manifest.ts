import { defineModule } from '@ecomkit/core/manifest';

/**
 * Truck meter: how full the delivery vehicle is for the cart's weight, as a cart block (full meter) and a
 * checkout-summary block (compact small-order bar). No tables; vehicles come from shipping.
 */
export default defineModule({
  id: 'truck-meter',
  dependsOn: ['core', 'cart', 'shipping'],
  cartBlocks: [
    { id: 'truck-meter', order: 20, placement: 'cart', component: () => import('./ui/TruckMeter').then((m) => m.TruckMeterBlock) },
    { id: 'truck-meter.bar', order: 20, placement: 'checkout-summary', component: () => import('./ui/TruckMeter').then((m) => m.SmallOrderBarBlock) },
  ],
});
