import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ModuleManifest } from '../src/contracts';
import core, { createRegistry, defineModule, GENERATED_HEADER, ModuleConfigError, planFiles, resolveModules, routeFilePath } from '../src/manifest';
import { fakeReviews } from '../src/testing/fakes';

const catalog = defineModule({
  id: 'catalog',
  dependsOn: ['core'],
  optional: ['reviews'],
  schema: async () => ({}),
  routes: [
    { path: '/plant/[slug]', module: 'routes/product-page', kind: 'page', exports: ['default', 'generateMetadata', 'generateStaticParams'] },
    { path: '/api/catalog/export', module: 'routes/export', kind: 'route', exports: ['GET'], segmentConfig: { maxDuration: 60 } },
  ],
  admin: {
    nav: [{ label: 'Products', href: '/admin/products', icon: 'package', order: 200, permission: 'products.read' }],
    pages: [{ path: '/admin/products', module: 'routes/admin-products', kind: 'page', exports: ['default'] }],
  },
  settings: { schema: z.object({ pageSize: z.number().int().default(24), apiKey: z.string().meta({ secret: true }) }) },
  permissions: ['products.read', 'products.write'],
  jobs: { 'catalog.reindex': { handler: async () => async (_data: { full: boolean }) => {} } },
  schedules: [{ job: 'catalog.reindex', cron: '0 3 * * *' }],
  emits: ['product.updated'],
  pdpSections: [{ id: 'faq', order: 20, slot: 'below', component: async () => () => null }],
  seedHooks: [{ id: 'products', order: 1, run: async () => async () => ({ inserted: 1, updated: 0, skipped: 0 }) }],
});

const payments = defineModule({
  id: 'payments',
  dependsOn: ['core', 'catalog'],
  mockRoutes: [{ path: '/api/_mock/phonepe/[...path]', module: 'routes/mock-phonepe', kind: 'route', exports: ['GET', 'POST'] }],
  admin: { nav: [{ label: 'Payments', href: '/admin/payments', icon: 'credit-card', order: 110 }] },
  on: { 'order.placed': async () => async (payload) => void payload.orderNumber },
  pdpSections: [{ id: 'pay-badges', order: 10, slot: 'aside', component: async () => () => null }],
  seedHooks: [{ id: 'methods', order: 0, run: async () => async () => ({ inserted: 0, updated: 0, skipped: 2 }) }],
});

const reviews = defineModule({ id: 'reviews', dependsOn: ['core', 'catalog'], provides: { reviews: async () => fakeReviews({ approved: 5 }) } });

const all: ModuleManifest[] = [core, catalog, payments, reviews];

describe('resolveModules', () => {
  it('orders by dependencies regardless of config order', () => {
    expect(resolveModules(all, ['payments', 'catalog', 'core']).map((m) => m.id)).toEqual(['core', 'catalog', 'payments']);
  });

  it('rejects a missing hard dependency, an unknown module and a missing core', () => {
    expect(() => resolveModules(all, ['core', 'payments'])).toThrow(/payments depends on catalog/);
    expect(() => resolveModules(all, ['core', 'nope'])).toThrow(/unknown module "nope"/);
    expect(() => resolveModules(all, ['catalog'])).toThrow(/core must be enabled/);
  });

  it('allows an optional dependency to be absent', () => {
    expect(resolveModules(all, ['core', 'catalog']).map((m) => m.id)).toEqual(['core', 'catalog']);
  });

  it('rejects cycles, duplicate files, bad mock paths, unprefixed jobs and duplicate providers', () => {
    const a = defineModule({ id: 'a', dependsOn: ['core', 'b'] });
    const b = defineModule({ id: 'b', dependsOn: ['core', 'a'] });
    expect(() => resolveModules([core, a, b], ['core', 'a', 'b'])).toThrow(/dependency cycle/);

    const clash = defineModule({ id: 'clash', dependsOn: ['core'], routes: [{ path: '/plant/[slug]', module: 'routes/x', kind: 'page', exports: ['default'] }] });
    expect(() => resolveModules([...all, clash], ['core', 'catalog', 'clash'])).toThrow(/both declare app\/\(shop\)\/plant\/\[slug\]\/page.tsx/);

    const badMock = defineModule({ id: 'bad-mock', dependsOn: ['core'], mockRoutes: [{ path: '/api/phonepe', module: 'routes/x', kind: 'route', exports: ['GET'] }] });
    expect(() => resolveModules([core, badMock], ['core', 'bad-mock'])).toThrow(/must be a route handler under \/api\/_mock\//);

    const badJob = defineModule({ id: 'jobs-x', dependsOn: ['core'], jobs: { reindex: { handler: async () => async () => {} } } });
    expect(() => resolveModules([core, badJob], ['core', 'jobs-x'])).toThrow(/must be named "jobs-x.<name>"/);

    const twin = defineModule({ id: 'twin', dependsOn: ['core', 'catalog'], provides: { reviews: async () => fakeReviews() } });
    expect(() => resolveModules([...all, twin], ['core', 'catalog', 'reviews', 'twin'])).toThrow(ModuleConfigError);

    const settingsPage = defineModule({ id: 'sp', dependsOn: ['core'], admin: { pages: [{ path: '/admin/settings/sp', module: 'routes/x', kind: 'page', exports: ['default'] }] } });
    expect(() => resolveModules([core, settingsPage], ['core', 'sp'])).toThrow(/rendered by admin-shell/);
  });
});

describe('routeFilePath', () => {
  it('maps pages to route groups and handlers to route.ts', () => {
    expect(routeFilePath({ path: '/plant/[slug]', kind: 'page' })).toBe('app/(shop)/plant/[slug]/page.tsx');
    expect(routeFilePath({ path: '/admin/products', kind: 'page' })).toBe('app/(admin)/admin/products/page.tsx');
    expect(routeFilePath({ path: '/sitemap.xml', kind: 'route' })).toBe('app/sitemap.xml/route.ts');
  });
});

describe('planFiles', () => {
  const ordered = resolveModules(all, ['core', 'catalog', 'payments']);

  it('writes mock route stubs only when mocks are on', () => {
    const dev = planFiles({ app: 'shop', modules: ['core', 'catalog', 'payments'], mocks: true }, ordered).map((f) => f.path);
    const prod = planFiles({ app: 'shop', modules: ['core', 'catalog', 'payments'], mocks: false }, ordered).map((f) => f.path);
    expect(dev).toContain('app/api/_mock/phonepe/[...path]/route.ts');
    expect(prod.some((p) => p.includes('_mock'))).toBe(false);
  });

  it('writes stubs that re-export from package exports with literal segment config', () => {
    const files = planFiles({ app: 'shop', modules: ['core', 'catalog'], mocks: false }, resolveModules(all, ['core', 'catalog']));
    const page = files.find((f) => f.path === 'app/(shop)/plant/[slug]/page.tsx')!;
    expect(page.contents).toBe(
      `${GENERATED_HEADER}\nexport { default, generateMetadata, generateStaticParams } from '@ecomkit/catalog/routes/product-page';\n`,
    );
    const handler = files.find((f) => f.path === 'app/api/catalog/export/route.ts')!;
    expect(handler.contents).toContain(`export { GET } from '@ecomkit/catalog/routes/export';\nexport const maxDuration = 60;`);
    expect(files.find((f) => f.path === 'src/generated/schema.ts')!.contents).toContain(`export * from '@ecomkit/catalog/schema';`);
    const registry = files.find((f) => f.path === 'src/generated/registry.ts')!.contents;
    expect(registry).toContain(`import m_catalog from '@ecomkit/catalog/manifest';`);
    expect(registry).toContain('createRegistry([m_core, m_catalog], { mocks: false })');
  });

  it('is deterministic and core-only produces the revalidate route, the registry and the schema list', () => {
    const plan = planFiles({ app: 'shop', modules: ['core'], mocks: true }, [core]);
    expect(plan.map((f) => f.path)).toEqual(['app/api/internal/revalidate/route.ts', 'src/generated/registry.ts', 'src/generated/schema.ts']);
    expect(plan.find((f) => f.path === 'src/generated/schema.ts')?.contents).toContain(`export * from '@ecomkit/core/schema';`);
    expect(planFiles({ app: 'shop', modules: ['core'], mocks: true }, [core])).toEqual(plan);
  });
});

describe('createRegistry', () => {
  const registry = createRegistry(resolveModules(all, ['core', 'catalog', 'payments']), { mocks: true });

  it('assembles nav, permissions, jobs, schedules and settings from enabled modules only', () => {
    expect(registry.nav.map((n) => [n.label, n.moduleId])).toEqual([
      ['Payments', 'payments'],
      ['Products', 'catalog'],
    ]);
    expect(registry.permissions).toEqual(expect.arrayContaining(['products.read', 'products.write', 'settings.write']));
    expect(registry.jobs.map((j) => j.name)).toEqual(['core.prune', 'catalog.reindex']);
    expect(registry.schedules.map((s) => [s.job, s.moduleId])).toEqual([
      ['core.prune', 'core'],
      ['catalog.reindex', 'catalog'],
    ]);
    expect(registry.settings.map((s) => s.moduleId)).toEqual(['catalog']);
    expect(registry.has('reviews')).toBe(false);
  });

  it('sorts extension points by order and seed hooks by module order first', () => {
    expect(registry.list('pdpSections').map((s) => s.id)).toEqual(['pay-badges', 'faq']);
    expect(registry.list('seedHooks').map((s) => `${s.moduleId}.${s.id}`)).toEqual(['catalog.products', 'payments.methods']);
  });

  it('wires event subscribers', () => {
    expect(registry.subscribers('order.placed').map((s) => s.moduleId)).toEqual(['payments']);
    expect(registry.subscribers('order.paid')).toEqual([]);
  });

  it('resolves an optional service to null when its module is off, and to the provider when on', async () => {
    expect(await registry.service('reviews')).toBeNull();
    const withReviews = createRegistry(resolveModules(all, ['core', 'catalog', 'reviews']), { mocks: false });
    expect((await withReviews.service('reviews'))?.aggregate).toBeTypeOf('function');
    expect(await withReviews.service('reviews')).toBe(await withReviews.service('reviews'));
  });
});
