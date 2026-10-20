import core, { createRegistry, planFiles, resolveModules } from '@ecomkit/core/manifest';
import { describe, expect, it } from 'vitest';
import manifest from '../src/manifest';

describe('manifest', () => {
  const ordered = resolveModules([core, manifest], ['core', 'notifications']);

  it('validates and only needs core (pick-and-choose)', () => {
    expect(ordered.map((m) => m.id)).toEqual(['core', 'notifications']);
  });

  it('mock routes are generated for dev configs only; real routes always', () => {
    const dev = planFiles({ app: 'shop', modules: ['core', 'notifications'], mocks: true }, ordered).map((f) => f.path);
    const prod = planFiles({ app: 'shop', modules: ['core', 'notifications'], mocks: false }, ordered).map((f) => f.path);
    for (const p of ['app/api/webhooks/whatsapp/route.ts', 'app/api/auth/gmail/callback/route.ts', 'app/(admin)/admin/messages/page.tsx', 'app/(admin)/admin/templates/page.tsx']) {
      expect(dev.some((x) => x.endsWith(p))).toBe(true);
      expect(prod.some((x) => x.endsWith(p))).toBe(true);
    }
    expect(dev.filter((x) => x.includes('%5Fmock'))).toHaveLength(2);
    expect(prod.filter((x) => x.includes('mock'))).toHaveLength(0);
  });

  it('every lazy reference resolves (jobs, actions, health checks, service, panel)', async () => {
    const lazies = [
      ...Object.values(manifest.jobs).map((j) => j.handler),
      ...manifest.settings.actions.map((a) => a.run),
      ...manifest.healthChecks.map((h) => h.run),
      manifest.provides.notifications,
      manifest.schema,
    ];
    for (const lazy of lazies) expect(await lazy()).toBeTruthy();
    const registry = createRegistry([core, manifest], { mocks: true });
    expect(registry.has('notifications')).toBe(true);
    expect(manifest.schedules.every((s) => s.job in manifest.jobs)).toBe(true);
  });
});
