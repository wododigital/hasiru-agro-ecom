import { enqueue, startWorker } from '@ecomkit/core/jobs';
import coreManifest, { createRegistry, planFiles, resolveModules } from '@ecomkit/core/manifest';
import type { TestDb } from '@ecomkit/core/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import monitoringManifest from '../src/manifest';
import { monitoringCheckResult } from '../src/schema';
import { configureMonitoring } from '../src/server';
import { configureRecipients, fakeTransports, monitoringDb } from './helpers';

const registry = createRegistry([coreManifest, monitoringManifest], { mocks: false });

describe('manifest', () => {
  it('needs only core (notifications and seo are optional)', () => {
    expect(resolveModules([coreManifest, monitoringManifest], ['core', 'monitoring']).map((m) => m.id)).toEqual(['core', 'monitoring']);
    expect(monitoringManifest.optional).toEqual(['notifications', 'seo']);
  });

  it('generates the health handlers and the admin pages inside the owned paths', () => {
    const paths = planFiles({ app: 'shop', modules: ['core', 'monitoring'], mocks: false }, [coreManifest, monitoringManifest])
      .map((f) => f.path)
      .filter((p) => p.startsWith('app/'));
    expect(paths.filter((p) => !p.startsWith('app/api/internal/'))).toEqual([
      'app/(admin)/admin/health/alerts/page.tsx',
      'app/(admin)/admin/health/errors/[id]/page.tsx',
      'app/(admin)/admin/health/errors/page.tsx',
      'app/(admin)/admin/health/jobs/page.tsx',
      'app/(admin)/admin/health/logs/page.tsx',
      'app/(admin)/admin/health/page.tsx',
      'app/api/health/live/route.ts',
      'app/api/health/ready/route.ts',
    ]);
  });

  it('every lazy reference resolves', async () => {
    for (const j of registry.jobs.filter((j) => j.moduleId === 'monitoring')) expect(typeof (await j.def.handler())).toBe('function');
    expect(typeof (await registry.subscribers('integration.failed')[0]!.handler())).toBe('function');
    expect(typeof (await registry.list('dashboardWidgets')[0]!.component())).toBe('function');
    const action = registry.settings.find((s) => s.moduleId === 'monitoring')!.settings.actions![0]!;
    expect(action).toMatchObject({ id: 'monitoring.test-alert', kind: 'test-connection' });
    expect(typeof (await action.run())).toBe('function');
    expect(registry.nav.find((n) => n.moduleId === 'monitoring')).toMatchObject({ href: '/admin/health', order: 800, permission: 'health.read' });
    for (const r of [...monitoringManifest.admin!.pages!, ...monitoringManifest.routes!]) {
      const mod = (await import(/* @vite-ignore */ new URL(`../src/${r.module}.tsx`, import.meta.url).href)) as Record<string, unknown>;
      for (const name of r.exports) expect(typeof mod[name]).toBe('function');
    }
  });
});

describe('worker', () => {
  let t: TestDb;
  let worker: { stop(): Promise<void> } | undefined;

  beforeAll(async () => {
    t = await monitoringDb('worker');
    fakeTransports();
    await configureRecipients({ selfCheckUrl: 'http://127.0.0.1:9/api/health/live' });
    worker = await startWorker(registry, { name: 'monitoring-test', pollingIntervalSeconds: 0.5 });
    configureMonitoring({ registry });
  });

  afterAll(async () => {
    await worker?.stop();
    configureMonitoring({ registry: null });
    await t?.close();
  });

  it('registers the minute tick, hourly and daily digests and the nightly checks in IST', async () => {
    const { rows } = await t.pool.query<{ name: string; cron: string; timezone: string }>("select name, cron, timezone from pgboss.schedule where name like 'monitoring.%' order by name");
    expect(rows).toEqual([
      { name: 'monitoring.daily', cron: '40 2 * * *', timezone: 'Asia/Kolkata' },
      { name: 'monitoring.digest-high', cron: '0 * * * *', timezone: 'Asia/Kolkata' },
      { name: 'monitoring.digest-low', cron: '0 9 * * *', timezone: 'Asia/Kolkata' },
      { name: 'monitoring.tick', cron: '* * * * *', timezone: 'Asia/Kolkata' },
    ]);
  });

  it('the tick job runs in the real worker: checks recorded, the worker heartbeat now passes', async () => {
    await enqueue('monitoring.tick');
    const until = Date.now() + 20_000;
    let rows: (typeof monitoringCheckResult.$inferSelect)[] = [];
    while (Date.now() < until) {
      rows = await t.db.select().from(monitoringCheckResult).where(eq(monitoringCheckResult.check, 'monitoring.worker'));
      if (rows.length) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(rows[0]).toMatchObject({ ok: true });
  });
});
