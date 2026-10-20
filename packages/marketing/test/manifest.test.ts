import coreManifest, { createRegistry, defineModule, planFiles } from '@ecomkit/core/manifest';
import customersManifest from '@ecomkit/customers/manifest';
import uiManifest from '@ecomkit/ui/manifest';
import { describe, expect, it } from 'vitest';
import manifest from '../src/manifest';

// customers needs auth; this package does not depend on auth, so a bare stand-in satisfies the resolver.
const authManifest = defineModule({ id: 'auth', dependsOn: ['core'] });

describe('manifest', () => {
  const modules = [coreManifest, uiManifest, authManifest, customersManifest, manifest];

  it('resolves without orders (optional) and subscribes to order.paid and order.refunded', async () => {
    const registry = createRegistry(modules, { mocks: false });
    expect(registry.has('marketing')).toBe(true);
    expect(registry.subscribers('order.paid').map((s) => s.moduleId)).toEqual(['marketing']);
    expect(registry.subscribers('order.refunded').map((s) => s.moduleId)).toEqual(['marketing']);
    expect(typeof (await registry.subscribers('order.paid')[0]!.handler())).toBe('function');
    expect(registry.nav.find((n) => n.moduleId === 'marketing')).toMatchObject({ href: '/admin/marketing/tags', order: 430, permission: 'marketing.write' });
  });

  it('generates the consent route and admin page, and the GA4/CAPI mocks only for mock configs', () => {
    const ids = modules.map((m) => m.id);
    const prod = planFiles({ app: 'shop', modules: ids, mocks: false }, modules).map((f) => f.path);
    expect(prod).toEqual(expect.arrayContaining(['app/api/consent/route.ts', 'app/(admin)/admin/marketing/tags/page.tsx']));
    expect(prod.some((p) => p.includes('_mock/ga4') || p.includes('_mock/meta-capi'))).toBe(false);
    const dev = planFiles({ app: 'shop', modules: ids, mocks: true }, modules).map((f) => f.path);
    expect(dev).toEqual(expect.arrayContaining(['app/api/_mock/ga4/[...path]/route.ts', 'app/api/_mock/meta-capi/[...path]/route.ts']));
  });

  it('every route module exports what the manifest says', async () => {
    const load: Record<string, () => Promise<Record<string, unknown>>> = {
      'routes/consent': () => import('../src/routes/consent'),
      'routes/admin-tags': () => import('../src/routes/admin-tags'),
      'mocks/ga4': () => import('../src/mocks/ga4'),
      'mocks/meta-capi': () => import('../src/mocks/meta-capi'),
    };
    for (const r of [...(manifest.routes ?? []), ...(manifest.admin?.pages ?? []), ...(manifest.mockRoutes ?? [])]) {
      const mod = await load[r.module]!();
      for (const name of r.exports) expect(typeof mod[name], `${r.module} ${name}`).toBe('function');
    }
  });

  it('mocks answer 404 unless ENABLE_MOCKS=1', async () => {
    const prev = process.env.ENABLE_MOCKS;
    delete process.env.ENABLE_MOCKS;
    const { POST } = await import('../src/mocks/ga4');
    expect((await POST(new Request('https://x/api/_mock/ga4/mp/collect', { method: 'POST', body: '{}' }))).status).toBe(404);
    process.env.ENABLE_MOCKS = prev;
  });
});
