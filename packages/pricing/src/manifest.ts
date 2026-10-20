import { defineModule } from '@ecomkit/core/manifest';

/**
 * Prices, compare-at, bulk tiers and the admin-only offline price. Provides the `pricing` service
 * (core `PricingReader`) and injects the Pricing tab into the catalog product form.
 */
export default defineModule({
  id: 'pricing',
  dependsOn: ['core', 'catalog'],
  schema: () => import('./schema'),
  permissions: ['pricing.write'],
  productFormTabs: [
    {
      id: 'pricing',
      label: 'Pricing',
      order: 20,
      permission: 'pricing.write',
      component: () => import('./admin/PricingTab').then((m) => m.PricingTab),
    },
  ],
  provides: { pricing: () => import('./server/pricing').then((m) => m.pricingReader) },
  seedHooks: [{ id: 'pricing.prices', order: 10, run: () => import('./server/seed').then((m) => m.seedHook) }],
  emits: ['price.changed'],
});
