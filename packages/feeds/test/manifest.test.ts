import catalogManifest from '@ecomkit/catalog/manifest';
import coreManifest, { createRegistry, planFiles } from '@ecomkit/core/manifest';
import inventoryManifest from '@ecomkit/inventory/manifest';
import mediaManifest from '@ecomkit/media/manifest';
import pricingManifest from '@ecomkit/pricing/manifest';
import uiManifest from '@ecomkit/ui/manifest';
import { describe, expect, it } from 'vitest';
import manifest from '../src/manifest';

describe('manifest', () => {
  const modules = [coreManifest, uiManifest, mediaManifest, catalogManifest, pricingManifest, inventoryManifest, manifest];

  it('resolves, schedules a daily full rebuild and subscribes to catalog, price and stock changes', async () => {
    const registry = createRegistry(modules, { mocks: false });
    for (const e of ['product.updated', 'product.published', 'price.changed', 'stock.changed'] as const) {
      expect(registry.subscribers(e).map((s) => s.moduleId)).toContain('feeds');
      expect(typeof (await registry.subscribers(e).find((s) => s.moduleId === 'feeds')!.handler())).toBe('function');
    }
    expect(registry.jobs.filter((j) => j.moduleId === 'feeds').map((j) => [j.name, j.def.options?.policy])).toEqual([['feeds.regenerate', 'stately']]);
    expect(registry.schedules.filter((s) => s.moduleId === 'feeds').map((s) => [s.job, s.cron, s.data])).toEqual([['feeds.regenerate', '15 3 * * *', { force: true }]]);
    expect(registry.nav.find((n) => n.moduleId === 'feeds')).toMatchObject({ href: '/admin/marketing/feeds', order: 440 });
  });

  it('generates the two feed routes and the admin page at the paths this package owns', () => {
    const files = planFiles({ app: 'shop', modules: modules.map((m) => m.id), mocks: false }, modules).map((f) => f.path);
    expect(files).toEqual(expect.arrayContaining(['app/feeds/google.xml/route.ts', 'app/feeds/meta.csv/route.ts', 'app/(admin)/admin/marketing/feeds/page.tsx']));
  });

  it('every route module and settings action exports what the manifest says', async () => {
    const load: Record<string, () => Promise<Record<string, unknown>>> = {
      'routes/google-feed': () => import('../src/routes/google-feed'),
      'routes/meta-feed': () => import('../src/routes/meta-feed'),
      'routes/admin-feeds': () => import('../src/routes/admin-feeds'),
    };
    for (const r of [...(manifest.routes ?? []), ...(manifest.admin?.pages ?? [])]) {
      const mod = await load[r.module]!();
      for (const name of r.exports) expect(typeof mod[name], `${r.module} ${name}`).toBe('function');
    }
    for (const a of manifest.settings!.actions!) expect(typeof (await a.run())).toBe('function');
  });
});
