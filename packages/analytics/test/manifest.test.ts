import coreManifest from '@ecomkit/core/manifest';
import { createRegistry, planFiles } from '@ecomkit/core/manifest';
import uiManifest from '@ecomkit/ui/manifest';
import { describe, expect, it } from 'vitest';
import manifest from '../src/manifest';

describe('manifest', () => {
  const modules = [coreManifest, uiManifest, manifest];

  it('resolves with core and ui only and declares its jobs, schedules and subscriptions', async () => {
    const registry = createRegistry(modules, { mocks: false });
    expect(registry.has('analytics')).toBe(true);
    expect(registry.jobs.filter((j) => j.moduleId === 'analytics').map((j) => j.name)).toEqual(['analytics.create-partition', 'analytics.rollup-daily']);
    expect(registry.schedules.filter((s) => s.moduleId === 'analytics').map((s) => [s.job, s.cron])).toEqual([
      ['analytics.create-partition', '0 2 25 * *'],
      ['analytics.rollup-daily', '30 1 * * *'],
    ]);
    expect(registry.subscribers('consent.changed').map((s) => s.moduleId)).toEqual(['analytics']);
    expect(registry.nav.find((n) => n.moduleId === 'analytics')).toMatchObject({ href: '/admin/analytics', order: 600, permission: 'analytics.read' });
    for (const job of registry.jobs.filter((j) => j.moduleId === 'analytics')) expect(typeof (await job.def.handler())).toBe('function');
    expect(typeof (await registry.subscribers('consent.changed')[0]!.handler())).toBe('function');
  });

  it('generates the collector, ingest and admin stubs at the paths this package owns', () => {
    const files = planFiles({ app: 'shop', modules: modules.map((m) => m.id), mocks: false }, modules).map((f) => f.path);
    expect(files).toEqual(expect.arrayContaining(['app/b.js/route.ts', 'app/api/beacon-ingest/route.ts', 'app/(admin)/admin/analytics/page.tsx']));
  });

  it('every route module exports what the manifest says', async () => {
    const load: Record<string, () => Promise<Record<string, unknown>>> = {
      'routes/beacon-script': () => import('../src/routes/beacon-script'),
      'routes/beacon-ingest': () => import('../src/routes/beacon-ingest'),
      'routes/admin-analytics': () => import('../src/routes/admin-analytics'),
    };
    for (const r of [...(manifest.routes ?? []), ...(manifest.admin?.pages ?? [])]) {
      const mod = await load[r.module]!();
      for (const name of r.exports) expect(typeof mod[name], `${r.module} ${name}`).toBe('function');
    }
  });

  it('serves the collector as cacheable JavaScript', async () => {
    const { GET } = await import('../src/routes/beacon-script');
    const res = GET();
    expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(res.headers.get('cache-control')).toContain('max-age=3600');
    expect(await res.text()).toContain('/api/beacon-ingest');
  });
});
