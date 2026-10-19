import type { HealthCheck } from '@ecomkit/core/contracts';
import coreManifest, { createRegistry, defineModule } from '@ecomkit/core/manifest';
import { coreJobHeartbeat } from '@ecomkit/core/schema';
import type { TestDb } from '@ecomkit/core/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import monitoringManifest from '../src/manifest';
import { GET as live } from '../src/routes/health-live';
import { GET as ready } from '../src/routes/health-ready';
import { monitoringAlert, monitoringCheckResult } from '../src/schema';
import { allChecks, configureMonitoring, readiness, registerHealthCheck, runCheck, runChecks, scanHealth } from '../src/server';
import { configureRecipients, fakeTransports, monitoringDb } from './helpers';

let t: TestDb;
const fake = fakeTransports();

const check = (id: string, status: 'ok' | 'degraded' | 'down' | 'not_configured', extra: Partial<HealthCheck> = {}): HealthCheck => ({
  id,
  label: id,
  critical: false,
  readiness: false,
  run: async () => async () => ({ status, detail: `${id} says ${status}` }),
  ...extra,
});

const beat = (lastSeen: Date) =>
  t.db.insert(coreJobHeartbeat).values({ worker: 'w1', lastSeen, queues: [] }).onConflictDoUpdate({ target: coreJobHeartbeat.worker, set: { lastSeen } });

beforeAll(async () => {
  t = await monitoringDb('checks');
  await configureRecipients();
});

afterAll(async () => {
  configureMonitoring({ registry: null });
  await t?.close();
});

beforeEach(async () => {
  fake.reset();
  configureMonitoring({ registry: null });
  await t.db.execute(sql`truncate monitoring_alert, monitoring_check_result, core_job_heartbeat, core_rate_limit`);
});

describe('built-in readiness checks', () => {
  it('database ok, worker down without a heartbeat, disk ok on the app folder', async () => {
    const results = await runChecks({ readinessOnly: true });
    expect(Object.fromEntries(results.map((r) => [r.id, r.status]))).toEqual({ 'monitoring.database': 'ok', 'monitoring.worker': 'down', 'monitoring.disk': 'ok' });
    expect(results.find((r) => r.id === 'monitoring.worker')!.detail).toBe('no worker heartbeat recorded');
  });

  it('worker heartbeat: fresh is ok, older than 2 minutes is down', async () => {
    await beat(new Date(Date.now() - 30_000));
    expect((await runChecks({ readinessOnly: true })).find((r) => r.id === 'monitoring.worker')!.status).toBe('ok');
    await beat(new Date(Date.now() - 150_000));
    expect((await runChecks({ readinessOnly: true })).find((r) => r.id === 'monitoring.worker')!.status).toBe('down');
  });

  it('disk: under 10% free fails', async () => {
    fake.state.diskFree = 0.05;
    const disk = (await runChecks()).find((r) => r.id === 'monitoring.disk')!;
    expect(disk).toMatchObject({ status: 'down', detail: `${process.cwd()} 5% free` });
  });

  it('disk: a folder that is not writable fails', async () => {
    await configureRecipients({ diskPaths: '/' });
    try {
      const disk = (await runChecks()).find((r) => r.id === 'monitoring.disk')!;
      expect(disk.status).toBe('down');
      expect(disk.detail).toContain('/ not writable');
    } finally {
      await configureRecipients({ diskPaths: '' });
    }
  });
});

describe('check registry', () => {
  it('collects built-ins, registered checks and manifest checks; first id wins', async () => {
    registerHealthCheck(check('app.custom', 'ok'));
    const other = defineModule({ id: 'payments', dependsOn: ['core'], healthChecks: [check('payments.webhook-signature', 'degraded'), check('monitoring.database', 'down')] });
    configureMonitoring({ registry: createRegistry([coreManifest, other, monitoringManifest], { mocks: false }) });
    const ids = allChecks().map((c) => c.id);
    expect(ids).toEqual(['monitoring.database', 'monitoring.worker', 'monitoring.disk', 'app.custom', 'payments.webhook-signature']);
    // The manifest's duplicate 'monitoring.database' (down) lost to the built-in.
    expect((await runChecks()).find((r) => r.id === 'monitoring.database')!.status).toBe('ok');
  });

  it('a throwing check is down with the reason; a hanging one times out', async () => {
    const boom = await runCheck({ ...check('boom', 'ok'), run: async () => async () => Promise.reject(new Error('socket hang up')) });
    expect(boom).toMatchObject({ status: 'down', detail: 'socket hang up' });
    const slow = await runCheck({ ...check('slow', 'ok'), run: async () => () => new Promise(() => {}) }, 50);
    expect(slow).toMatchObject({ status: 'down', detail: 'no answer within 50 ms' });
  });

  it('records one row per check when asked', async () => {
    const results = await runChecks({ record: true });
    const rows = await t.db.select().from(monitoringCheckResult);
    expect(rows).toHaveLength(results.length);
    expect(rows.find((r) => r.check === 'monitoring.worker')).toMatchObject({ ok: false, detail: { status: 'down', detail: 'no worker heartbeat recorded' } });
  });
});

describe('health endpoints', () => {
  it('/api/health/live answers 200 with no dependencies', async () => {
    const res = await live();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ status: 'ok' });
  });

  it('/api/health/ready: 503 while a readiness check is down, 200 once healthy; ids and statuses only', async () => {
    let res = await ready();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; checks: Record<string, unknown>[] };
    expect(body.status).toBe('down');
    for (const c of body.checks) expect(Object.keys(c).sort()).toEqual(['id', 'status']);

    await beat(new Date());
    res = await ready(); // memoised for 5 s
    expect(res.status).toBe(503);
    expect((await readiness({ fresh: true })).status).toBe('ok');
    res = await ready();
    expect(res.status).toBe(200);
  });

  it('a degraded readiness check is reported but stays 200', async () => {
    await beat(new Date());
    registerHealthCheck(check('app.readiness-degraded', 'degraded', { readiness: true }));
    try {
      expect(await readiness({ fresh: true })).toMatchObject({ status: 'degraded' });
      expect((await ready()).status).toBe(200);
    } finally {
      registerHealthCheck(check('app.readiness-degraded', 'ok', { readiness: true }));
    }
  });
});

describe('scanHealth -> alerts', () => {
  it('down checks raise health.down (critical for critical checks), degraded raise health.degraded (low), cleared ones resolve', async () => {
    registerHealthCheck(check('app.payments', 'down', { critical: true }));
    registerHealthCheck(check('app.stale-orders', 'degraded'));
    const now = new Date();
    await scanHealth(now);
    let rows = await t.db.select().from(monitoringAlert);
    const by = (fp: string) => rows.find((r) => r.fingerprint === fp);
    expect(by('app.payments')).toMatchObject({ ruleKey: 'health.down', severity: 'critical', status: 'open', title: 'app.payments is down' });
    expect(by('monitoring.worker')).toMatchObject({ ruleKey: 'health.down', severity: 'critical' });
    expect(by('app.stale-orders')).toMatchObject({ ruleKey: 'health.degraded', severity: 'low' });
    expect(fake.state.sent.filter((s) => s.channel === 'whatsapp')).toHaveLength(2);

    // Next minute, still down: no new rows, no new messages.
    const sent = fake.state.sent.length;
    await scanHealth(new Date(now.getTime() + 60_000));
    expect(await t.db.select().from(monitoringAlert)).toHaveLength(3);
    expect(fake.state.sent).toHaveLength(sent);

    // Recovered.
    registerHealthCheck(check('app.payments', 'ok', { critical: true }));
    registerHealthCheck(check('app.stale-orders', 'ok'));
    await beat(new Date());
    await scanHealth(new Date(now.getTime() + 120_000));
    rows = await t.db.select().from(monitoringAlert);
    expect(rows.every((r) => r.status === 'resolved')).toBe(true);
  });
});
