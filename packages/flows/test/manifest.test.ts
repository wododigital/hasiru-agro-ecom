import core, { createRegistry, defineModule, planFiles, resolveModules } from '@ecomkit/core/manifest';
import customers from '@ecomkit/customers/manifest';
import notifications from '@ecomkit/notifications/manifest';
import { describe, expect, it } from 'vitest';
import manifest from '../src/manifest';

describe('manifest', () => {
  // customers needs auth; a stand-in keeps this test to the modules flows declares.
  const auth = defineModule({ id: 'auth', dependsOn: ['core'] });
  const all = [core, auth, notifications, customers, manifest];
  const ids = ['core', 'auth', 'notifications', 'customers', 'flows'];

  it('needs only core, notifications and customers (cart, orders, discounts are optional)', () => {
    expect(resolveModules(all, ids).map((m) => m.id)).toEqual(['core', 'auth', 'notifications', 'customers', 'flows']);
    expect(manifest.optional).toEqual(expect.arrayContaining(['cart', 'orders', 'discounts']));
  });

  it('generates the restore route and the three admin pages', () => {
    const paths = planFiles({ app: 'shop', modules: ids, mocks: false }, resolveModules(all, ids)).map((f) => f.path);
    for (const p of ['app/r/[token]/route.ts', 'app/(admin)/admin/marketing/automations/page.tsx', 'app/(admin)/admin/marketing/automations/[key]/page.tsx', 'app/(admin)/admin/abandoned-checkouts/page.tsx']) {
      expect(paths.some((x) => x.endsWith(p)), p).toBe(true);
    }
  });

  it('every lazy reference resolves and the schedule names its own job', async () => {
    const lazies = [...Object.values(manifest.jobs).map((j) => j.handler), ...Object.values(manifest.on), manifest.schema];
    for (const lazy of lazies) expect(typeof (await lazy())).not.toBe('undefined');
    expect(manifest.schedules.every((s) => s.job in manifest.jobs)).toBe(true);
    const registry = createRegistry(resolveModules(all, ids), { mocks: false });
    expect(registry.subscribers('cart.abandoned').map((s) => s.moduleId)).toEqual(['flows']);
  });
});
