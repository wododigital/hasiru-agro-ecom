import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { integrationCall } from '@ecomkit/core/http';
import { ensureQueue, getBoss } from '@ecomkit/core/jobs';
import { captureError, setIssueStatus } from '@ecomkit/core/observability';
import type { TestDb } from '@ecomkit/core/testing';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { monitoringAlert, monitoringCheckResult } from '../src/schema';
import { getRuntime } from '../src/server/runtime';
import {
  BACKUP_CHECK,
  daily,
  onIntegrationFailed,
  recordCheck,
  scanBackup,
  scanDatabase,
  scanDomains,
  scanErrors,
  scanIntegrations,
  scanJobs,
  scanUptime,
  tick,
  type NetLookups,
} from '../src/server';
import { monitoringSettings } from '../src/server/settings';
import { configureRecipients, fakeTransports, minutes, monitoringDb } from './helpers';

// Captured before the fakes replace it: the real filesystem probe.
const realStatDisk = getRuntime().statDisk;
let t: TestDb;
const fake = fakeTransports();
let server: Server;
let serverStatus = 200;
let liveUrl = '';

const alerts = (ruleKey: string) => t.db.select().from(monitoringAlert).where(eq(monitoringAlert.ruleKey, ruleKey));
const open = async (ruleKey: string) => (await alerts(ruleKey)).filter((a) => a.status !== 'resolved');
const ctx = { eventId: 'e1', emittedAt: new Date(), log: { info() {}, warn() {}, error() {} } };

beforeAll(async () => {
  t = await monitoringDb('scans');
  await configureRecipients();
  server = createServer((_req, res) => {
    res.statusCode = serverStatus;
    res.end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  liveUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/health/live`;
});

afterAll(async () => {
  server?.close();
  await t?.close();
});

beforeEach(async () => {
  fake.reset();
  await t.db.execute(sql`truncate monitoring_alert, monitoring_check_result, core_rate_limit, core_error_issue cascade`);
});

describe('server errors', () => {
  it('a new error issue raises error.issue; checkout routes are critical; resolving the issue resolves the alert', async () => {
    const issueId = await captureError(new TypeError('cannot read total'), { route: '/checkout', method: 'POST' });
    await captureError(new RangeError('bad page'), { route: '/plants' });
    const settings = await monitoringSettings();
    await scanErrors(new Date(), settings);
    const rows = await open('error.issue');
    expect(rows.map((r) => [r.severity, r.title]).sort()).toEqual([
      ['critical', 'Server error: TypeError: cannot read total'],
      ['high', 'Server error: RangeError: bad page'],
    ]);
    expect(rows.find((r) => r.severity === 'critical')!.body).toContain('Route /checkout');

    // Still open next minute: nothing new.
    await scanErrors(new Date(), settings);
    expect(await alerts('error.issue')).toHaveLength(2);

    await setIssueStatus(issueId!, 'resolved');
    await scanErrors(new Date(), settings);
    expect((await open('error.issue')).map((r) => r.title)).toEqual(['Server error: RangeError: bad page']);
  });

  it('more than the threshold in 10 minutes is a spike', async () => {
    await configureRecipients({ errorSpikeThreshold: 5 });
    try {
      for (let i = 0; i < 6; i++) await captureError(new Error(`timeout ${i}`), { route: '/api/search/suggest' });
      await scanErrors(new Date(), await monitoringSettings());
      const [spike] = await open('error.spike');
      expect(spike).toMatchObject({ title: 'Error spike: Error: timeout 0', body: '6 times in the last 10 minutes.' });
      // Ten minutes later the window is empty: resolved.
      await scanErrors(new Date(Date.now() + minutes(11)), await monitoringSettings());
      expect(await open('error.spike')).toHaveLength(0);
    } finally {
      await configureRecipients({ errorSpikeThreshold: 20 });
    }
  });
});

describe('job queue', () => {
  it('dead-letter arrivals and backlog raise alerts and resolve when cleared', async () => {
    const boss = await getBoss();
    await ensureQueue(boss, 'wp11.sample');
    await ensureQueue(boss, 'wp11.busy');
    await boss.send('wp11.sample.dead', { failed: true });
    for (let i = 0; i < 11; i++) await boss.send('wp11.busy', { i });
    await configureRecipients({ jobBacklogLimit: 10 });
    try {
      await scanJobs(new Date(), await monitoringSettings());
      expect((await open('jobs.dead-letter')).map((a) => [a.fingerprint, a.title])).toEqual([['wp11.sample.dead', 'Failed jobs in wp11.sample.dead']]);
      expect((await open('jobs.backlog')).map((a) => a.body)).toEqual(['11 jobs waiting (limit 10).']);

      await t.pool.query("delete from pgboss.job where name in ('wp11.sample.dead', 'wp11.busy')");
      await scanJobs(new Date(), await monitoringSettings());
      expect(await open('jobs.dead-letter')).toHaveLength(0);
      expect(await open('jobs.backlog')).toHaveLength(0);
    } finally {
      await configureRecipients({ jobBacklogLimit: 500 });
    }
  });
});

describe('integrations', () => {
  const fail = () => integrationCall('wp11pay', 'status', async () => Promise.reject(new Error('HTTP 502 from provider')));

  it('one or two failures do not page; three in 15 minutes do; a later success resolves', async () => {
    await fail();
    await fail();
    await onIntegrationFailed({ provider: 'wp11pay', operation: 'status', error: 'HTTP 502 from provider' }, ctx);
    expect(await alerts('integration.failed')).toHaveLength(0);

    await fail();
    await onIntegrationFailed({ provider: 'wp11pay', operation: 'status', error: 'HTTP 502 from provider' }, ctx);
    const [a] = await open('integration.failed');
    expect(a).toMatchObject({ fingerprint: 'wp11pay:status', severity: 'high', title: 'wp11pay status is failing' });
    expect(a!.body).toContain('3 failures in 15 minutes');

    await scanIntegrations(new Date());
    expect(await open('integration.failed')).toHaveLength(1);
    await integrationCall('wp11pay', 'status', async () => 'ok');
    await scanIntegrations(new Date());
    expect(await open('integration.failed')).toHaveLength(0);
  });
});

describe('uptime self-check', () => {
  it('records each probe; a failing or unreachable site raises a critical alert that resolves on recovery', async () => {
    await configureRecipients({ selfCheckUrl: liveUrl });
    try {
      serverStatus = 200;
      await scanUptime(new Date(), await monitoringSettings());
      expect(await alerts('uptime.live')).toHaveLength(0);

      serverStatus = 503;
      await scanUptime(new Date(), await monitoringSettings());
      const [down] = await open('uptime.live');
      expect(down).toMatchObject({ severity: 'critical', title: 'The site is not answering' });
      expect(down!.body).toContain('HTTP 503');
      expect(fake.state.sent.map((s) => s.channel)).toEqual(['whatsapp', 'email']);

      serverStatus = 200;
      await scanUptime(new Date(), await monitoringSettings());
      expect(await open('uptime.live')).toHaveLength(0);

      await configureRecipients({ selfCheckUrl: 'http://127.0.0.1:9/api/health/live' });
      await scanUptime(new Date(), await monitoringSettings());
      expect(await open('uptime.live')).toHaveLength(1);

      const probes = await t.db.select().from(monitoringCheckResult).where(eq(monitoringCheckResult.check, 'uptime.live'));
      expect(probes.map((p) => p.ok)).toEqual([true, false, true, false]);
    } finally {
      await configureRecipients({ selfCheckUrl: '' });
    }
  });
});

describe('daily checks', () => {
  const NOW = new Date('2026-10-20T04:30:00Z');
  const net = (over: Partial<NetLookups> = {}): NetLookups => ({
    certExpiry: async () => new Date('2027-01-01T00:00:00Z'),
    domainExpiry: async () => new Date('2027-06-01T00:00:00Z'),
    dns: async () => ({ a: ['203.0.113.10'], mx: ['mx.shop.test'], txt: ['v=spf1 ~all'], dmarc: ['v=DMARC1; p=none'] }),
    ...over,
  });

  it('certificate under 14 days, domain under 30 days and missing DNS records raise alerts per domain', async () => {
    await configureRecipients({ domains: 'www.shop.test, shop.test' });
    try {
      const settings = await monitoringSettings();
      await scanDomains(NOW, settings, net());
      expect([...(await open('ssl.expiry')), ...(await open('domain.expiry')), ...(await open('dns.records'))]).toHaveLength(0);

      await scanDomains(
        NOW,
        settings,
        net({
          certExpiry: async (host) => (host === 'www.shop.test' ? new Date('2026-10-25T00:00:00Z') : new Date('2027-01-01T00:00:00Z')),
          domainExpiry: async () => new Date('2026-11-10T00:00:00Z'),
          dns: async (host) => ({ a: ['203.0.113.10'], mx: [], txt: [], dmarc: host === 'shop.test' ? ['v=DMARC1; p=none'] : [] }),
        }),
      );
      expect((await open('ssl.expiry')).map((a) => a.title)).toEqual(['Certificate for www.shop.test expires in 4 days (2026-10-25)']);
      // One registration for both hosts (apex).
      expect((await open('domain.expiry')).map((a) => [a.fingerprint, a.title])).toEqual([['shop.test', 'Domain shop.test expires in 20 days (2026-11-10)']]);
      expect((await open('dns.records')).map((a) => a.title).sort()).toEqual(['DNS records missing for shop.test: MX, SPF', 'DNS records missing for www.shop.test: MX, SPF, DMARC']);

      // Certificate renewed, TLS failure on the other host, registration unknown (RDAP down): no registration alert.
      await scanDomains(
        NOW,
        settings,
        net({
          certExpiry: async (host) => {
            if (host === 'shop.test') throw new Error('ECONNREFUSED');
            return new Date('2027-01-20T00:00:00Z');
          },
          domainExpiry: async () => Promise.reject(new Error('rdap down')),
        }),
      );
      expect((await open('ssl.expiry')).map((a) => [a.fingerprint, a.title])).toEqual([['shop.test', 'Could not read the certificate for shop.test']]);
      expect(await open('domain.expiry')).toHaveLength(0);
      expect(await open('dns.records')).toHaveLength(0);
    } finally {
      await configureRecipients({ domains: '' });
    }
  });

  it('backup: missing or older than the limit raises backup.stale; a fresh success resolves it', async () => {
    const settings = await monitoringSettings();
    await scanBackup(NOW, settings);
    expect((await open('backup.stale')).map((a) => a.title)).toEqual(['No successful backup recorded']);
    await recordCheck(BACKUP_CHECK, true, { now: new Date(NOW.getTime() - minutes(60)) });
    await scanBackup(NOW, settings);
    expect(await open('backup.stale')).toHaveLength(0);
    await scanBackup(new Date(NOW.getTime() + minutes(26 * 60)), settings);
    expect((await open('backup.stale')).map((a) => a.title)).toEqual(['Last backup is older than 26 hours']);
  });

  it('database: records size and connection use', async () => {
    await scanDatabase(NOW);
    const [row] = await t.db.select().from(monitoringCheckResult).where(eq(monitoringCheckResult.check, 'db.stats'));
    expect(row!.ok).toBe(true);
    expect(row!.detail).toMatchObject({ sizeBytes: expect.any(Number), connections: expect.any(Number), maxConnections: expect.any(Number) });
    expect(await open('db.connections')).toHaveLength(0);
  });

  it('daily() runs every part and prunes old check results and old resolved alerts', async () => {
    const old = new Date(NOW.getTime() - 31 * 24 * minutes(60));
    await recordCheck('old.check', true, { now: old });
    await t.db.insert(monitoringAlert).values({ ruleKey: 'x.y', fingerprint: 'old', title: 'Old', severity: 'low', status: 'resolved', resolvedAt: new Date(NOW.getTime() - 91 * 24 * minutes(60)) });
    await configureRecipients({ domains: 'shop.test' });
    try {
      await daily({ now: NOW, net: net() });
    } finally {
      await configureRecipients({ domains: '' });
    }
    expect(await t.db.select().from(monitoringCheckResult).where(eq(monitoringCheckResult.check, 'old.check'))).toHaveLength(0);
    expect(await t.db.select().from(monitoringAlert).where(and(eq(monitoringAlert.ruleKey, 'x.y')))).toHaveLength(0);
    const checks = (await t.db.select({ c: monitoringCheckResult.check }).from(monitoringCheckResult)).map((r) => r.c).sort();
    expect(checks).toEqual(['db.stats', 'dns:shop.test', 'domain:shop.test', 'ssl:shop.test']);
  });
});

describe('minute tick', () => {
  it('runs health, errors, jobs, integrations, uptime and repeats; a failing part does not stop the others', async () => {
    await configureRecipients({ selfCheckUrl: liveUrl });
    serverStatus = 200;
    try {
      await tick();
    } finally {
      await configureRecipients({ selfCheckUrl: '' });
    }
    const checks = new Set((await t.db.select({ c: monitoringCheckResult.check }).from(monitoringCheckResult)).map((r) => r.c));
    expect([...checks].sort()).toEqual(['monitoring.database', 'monitoring.disk', 'monitoring.worker', 'uptime.live']);
    // No worker heartbeat in this database: the critical worker alert is up.
    expect((await open('health.down')).map((a) => a.fingerprint)).toEqual(['monitoring.worker']);
  });
});

describe('real disk probe', () => {
  it('reads free and total bytes of the app folder', async () => {
    const s = await realStatDisk(process.cwd());
    expect(s.totalBytes).toBeGreaterThan(0);
    expect(s.freeBytes).toBeGreaterThanOrEqual(0);
    expect(s.freeBytes).toBeLessThanOrEqual(s.totalBytes);
  });
});
