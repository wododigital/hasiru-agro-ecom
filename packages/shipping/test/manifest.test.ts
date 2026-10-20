import coreManifest, { createRegistry, planFiles, resolveModules } from '@ecomkit/core/manifest';
import { describe, expect, it } from 'vitest';
import shippingManifest from '../src/manifest';

describe('manifest', () => {
  it('needs only core (places is optional)', () => {
    expect(resolveModules([coreManifest, shippingManifest], ['core', 'shipping']).map((m) => m.id)).toEqual(['core', 'shipping']);
  });

  it('generates the delivery-check handler and no admin route under settings', () => {
    const paths = planFiles({ app: 'shop', modules: ['core', 'shipping'], mocks: false }, [coreManifest, shippingManifest]).map((f) => f.path);
    expect(paths).toContain('app/api/delivery-check/route.ts');
    expect(paths.some((p) => p.includes('admin/settings'))).toBe(false);
  });

  it('provides the shipping service and wires every lazy reference', async () => {
    const registry = createRegistry([coreManifest, shippingManifest], { mocks: false });
    const quoter = await registry.service('shipping');
    expect(Object.keys(quoter ?? {}).sort()).toEqual(['pickVehicle', 'quoteMethods']);
    expect(typeof (await shippingManifest.settings!.customPanel!())).toBe('function');
    expect(typeof (await registry.list('pdpSections')[0]!.component())).toBe('function');
    expect(typeof (await registry.list('seedHooks')[0]!.run())).toBe('function');
    expect(typeof (await registry.subscribers('order.cancelled')[0]!.handler())).toBe('function');
    expect(typeof (await registry.subscribers('order.payment_failed')[0]!.handler())).toBe('function');
    expect(typeof (await registry.jobs.find((j) => j.name === 'shipping.slot-reminders')!.def.handler())).toBe('function');
    expect(registry.schedules.map((s) => s.job)).toContain('shipping.slot-reminders');
  });
});
