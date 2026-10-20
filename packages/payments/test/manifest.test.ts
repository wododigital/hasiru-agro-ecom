import core, { createRegistry, defineModule, planFiles, resolveModules } from '@ecomkit/core/manifest';
import { describe, expect, it } from 'vitest';
import manifest from '../src/manifest';

// orders ships in the same wave; a bare manifest stands in for it here.
const orders = defineModule({ id: 'orders', dependsOn: ['core'] });

describe('manifest', () => {
  const ids = ['core', 'orders', 'payments'];
  const ordered = resolveModules([core, orders, manifest], ids);

  it('needs only core and orders (pick-and-choose)', () => {
    expect(ordered.map((m) => m.id)).toEqual(ids);
    expect(() => resolveModules([core, manifest], ['core', 'payments'])).toThrow();
  });

  it('mock gateway routes exist only for mock configs; webhook, return page and admin always', () => {
    const dev = planFiles({ app: 'shop', modules: ids, mocks: true }, ordered).map((f) => f.path);
    const prod = planFiles({ app: 'shop', modules: ids, mocks: false }, ordered).map((f) => f.path);
    for (const p of ['app/api/webhooks/phonepe/route.ts', 'app/(shop)/pay/return/page.tsx', 'app/(admin)/admin/payments/page.tsx']) {
      expect(dev.some((x) => x.endsWith(p))).toBe(true);
      expect(prod.some((x) => x.endsWith(p))).toBe(true);
    }
    expect(dev.filter((x) => x.includes('%5Fmock'))).toEqual([expect.stringContaining('app/api/%5Fmock/phonepe/[...path]/route.ts')]);
    expect(prod.filter((x) => x.includes('mock'))).toHaveLength(0);
  });

  it('every lazy reference resolves and schedules name own jobs', async () => {
    const lazies = [...Object.values(manifest.jobs).map((j) => j.handler), ...manifest.settings.actions.map((a) => a.run), ...manifest.healthChecks.map((h) => h.run), manifest.schema];
    for (const lazy of lazies) expect(await lazy()).toBeTruthy();
    expect(manifest.schedules.every((s) => s.job in manifest.jobs)).toBe(true);
    expect(manifest.settings.actions.map((a) => a.kind)).toEqual(['test-connection']);
    expect(createRegistry([core, orders, manifest], { mocks: true }).has('payments')).toBe(true);
  });

  it('every route module exports what the manifest lists', async () => {
    const mods = import.meta.glob('../src/{routes,mocks}/*.{ts,tsx}');
    for (const r of [...manifest.routes, ...manifest.mockRoutes, ...manifest.admin.pages]) {
      const key = Object.keys(mods).find((k) => k.includes(`/src/${r.module}.`));
      expect(key, r.module).toBeTruthy();
      const mod = (await mods[key!]!()) as Record<string, unknown>;
      for (const e of r.exports) expect(typeof mod[e], `${r.module} ${e}`).toBe('function');
    }
  });
});
