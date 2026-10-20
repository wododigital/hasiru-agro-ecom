import { defineModule } from '@ecomkit/core/manifest';
import { plantingSettingsSchema } from './settings';

export default defineModule({
  id: 'planting',
  // cart, farm-calculators and auth are reached through configurePlanting ports (package, inputs, OTP) and degrade
  // when absent, so they are optional here; see BUILD-STATUS/wp-24.md.
  dependsOn: ['core', 'ui', 'catalog', 'pricing', 'customers', 'places'],
  optional: ['cart', 'farm-calculators', 'auth', 'cms', 'inventory', 'ai-assistant', 'planting-3d', 'seo'],
  schema: () => import('./schema'),
  routes: [
    { path: '/plan', module: 'routes/plan', kind: 'page', exports: ['default', 'generateMetadata'] },
    { path: '/plan/results/[planId]', module: 'routes/plan-results', kind: 'page', exports: ['default', 'generateMetadata'] },
    // Unknown models wait for the full render (real 404 status) instead of the shared fallback shell.
    { path: '/models/[model]', module: 'routes/model', kind: 'page', exports: ['default', 'generateMetadata', 'generateStaticParams'], segmentConfig: { unstable_paramMatching: { model: 'blocking' } } },
    { path: '/plants/for/[model]', module: 'routes/plants-for', kind: 'page', exports: ['default', 'generateMetadata', 'generateStaticParams'], segmentConfig: { unstable_paramMatching: { model: 'blocking' } } },
    { path: '/api/plan/generate', module: 'routes/api-generate', kind: 'route', exports: ['POST'] },
    { path: '/api/plan/unlock', module: 'routes/api-unlock', kind: 'route', exports: ['POST'] },
  ],
  admin: {
    nav: [{ label: 'Planting models', href: '/admin/planting', icon: 'trees', order: 250, permission: 'products.write' }],
    pages: [
      { path: '/admin/planting', module: 'routes/admin-planting', kind: 'page', exports: ['default'] },
      { path: '/admin/planting/[model]', module: 'routes/admin-planting-model', kind: 'page', exports: ['default'] },
    ],
  },
  settings: { schema: plantingSettingsSchema },
  permissions: ['products.write'],
  emits: ['plan.generated', 'plan.unlocked', 'lead.created'],
  cacheTags: ['model:*'],
  pdpSections: [{ id: 'planting.companions', order: 60, slot: 'below', component: () => import('./ui/Companions').then((m) => m.default) }],
  sitemapSources: [{ name: 'models', entries: () => import('./server/sitemap').then((m) => m.modelSitemapEntries) }],
  seedHooks: [{ id: 'planting', order: 300, run: () => import('./server/seed').then((m) => m.runPlantingSeed) }],
});
