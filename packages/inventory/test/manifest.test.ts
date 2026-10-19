import coreManifest, { createRegistry, defineModule, planFiles, resolveModules } from '@ecomkit/core/manifest';
import { describe, expect, it } from 'vitest';
import inventoryManifest from '../src/manifest';

const catalogStandIn = defineModule({ id: 'catalog', dependsOn: ['core'] });

describe('manifest', () => {
  it('resolves after core and catalog, and fails without catalog', () => {
    expect(resolveModules([coreManifest, catalogStandIn, inventoryManifest], ['core', 'catalog', 'inventory']).map((m) => m.id)).toEqual(['core', 'catalog', 'inventory']);
    expect(() => resolveModules([coreManifest, inventoryManifest], ['core', 'inventory'])).toThrow();
  });

  it('generates the notify-me handler and both admin pages', () => {
    const paths = planFiles({ app: 'shop', modules: ['core', 'catalog', 'inventory'], mocks: false }, [coreManifest, catalogStandIn, inventoryManifest]).map((f) => f.path);
    expect(paths).toEqual(expect.arrayContaining(['app/api/notify-me/route.ts', 'app/(admin)/admin/inventory/page.tsx', 'app/(admin)/admin/inventory/[variantId]/page.tsx']));
  });

  it('provides the inventory service and wires every lazy reference', async () => {
    const registry = createRegistry([coreManifest, catalogStandIn, inventoryManifest], { mocks: false });
    const ops = await registry.service('inventory');
    expect(Object.keys(ops ?? {}).sort()).toEqual(['commit', 'getStock', 'getStocks', 'release', 'reserve']);
    const [tab] = registry.list('productFormTabs');
    expect(tab).toMatchObject({ id: 'inventory', moduleId: 'inventory', permission: 'inventory.read' });
    expect(typeof (await tab!.component())).toBe('function');
    expect(typeof (await registry.list('pdpSections')[0]!.component())).toBe('function');
    expect(typeof (await registry.list('seedHooks')[0]!.run())).toBe('function');
    expect(typeof (await registry.subscribers('stock.changed')[0]!.handler())).toBe('function');
    expect(registry.jobs.map((j) => j.name)).toContain('inventory.release-expired');
    expect(registry.nav.find((n) => n.moduleId === 'inventory')).toMatchObject({ href: '/admin/inventory', order: 230 });
  });
});
