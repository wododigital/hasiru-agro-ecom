import { defineModule } from '@ecomkit/core/manifest';

export default defineModule({
  id: 'farm-calculators',
  dependsOn: ['core', 'catalog', 'pricing'],
  // "Add to cart" buttons render only when the cart is enabled (registry.has('cart') bound at boot).
  optional: ['cart'],
  schema: () => import('./schema'),
  routes: [
    { path: '/calculators/plants', module: 'routes/calculators-plants', kind: 'page', exports: ['default', 'generateMetadata'] },
    { path: '/calculators/compost', module: 'routes/calculators-compost', kind: 'page', exports: ['default', 'generateMetadata'] },
    { path: '/api/calculators/plants', module: 'routes/api-calculator-plants', kind: 'route', exports: ['GET'] },
  ],
  admin: {
    nav: [{ label: 'Dosage rules', href: '/admin/dosage-rules', icon: 'flask-conical', order: 210, permission: 'products.read' }],
    pages: [{ path: '/admin/dosage-rules', module: 'routes/admin-dosage-rules', kind: 'page', exports: ['default', 'generateMetadata'] }],
  },
  permissions: ['products.read', 'products.write'],
  cacheTags: ['settings:farm-calculators', 'catalog'],
  seedHooks: [{ id: 'dosage-rules', order: 20, run: () => import('./server/seed').then((m) => m.seedDosageRules) }],
});
