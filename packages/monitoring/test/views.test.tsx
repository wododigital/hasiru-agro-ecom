import { setAuthProvider } from '@ecomkit/core/auth-context';
import { PERMISSIONS, type AuthContext, type Permission, type StaffViewer } from '@ecomkit/core/contracts';
import { integrationCall, NotConfiguredError } from '@ecomkit/core/http';
import { ensureQueue, getBoss } from '@ecomkit/core/jobs';
import { captureError } from '@ecomkit/core/observability';
import { TEST_NOW, type TestDb } from '@ecomkit/core/testing';
import { eq, sql } from 'drizzle-orm';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ackAlertAction, issueStatusAction, retryJobAction, updateRuleAction } from '../src/admin/actions';
import { AlertBell, AlertsPage, AlertsWidget, ErrorDetailPage, HealthOverviewPage, JobsPage } from '../src/admin';
import AdminHealthRoute from '../src/routes/admin-health';
import { monitoringAlert } from '../src/schema';
import { alert, checkHistory, getRule, integrationCards, listFailedJobs, listIssues, listQueues, recordCheck, retryJob } from '../src/server';
import { configureRecipients, fakeTransports, minutes, monitoringDb } from './helpers';

// Next request APIs have no request scope under vitest.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace() {}, push() {} }),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

let t: TestDb;
fakeTransports();
const STAFF_ID = '01900000-0000-7000-8000-0000000000aa';

function signInAs(permissions: readonly Permission[] | null): void {
  const viewer: StaffViewer | null = permissions ? { kind: 'staff', userId: STAFF_ID, name: 'Dev', email: 'dev@example.test', role: 'owner', permissions: [...permissions] } : null;
  const auth: AuthContext = {
    getViewer: async () => viewer ?? { kind: 'guest' },
    requirePermission: async (p) => {
      if (viewer?.permissions.includes(p)) return viewer;
      const { ForbiddenError } = await import('@ecomkit/core/auth-context');
      throw new ForbiddenError();
    },
    requireOwner: async () => {
      throw new Error('not used');
    },
  };
  setAuthProvider(async () => auth);
}

const html = async (el: Promise<ReactElement>) => renderToStaticMarkup(await el);
const form = (fields: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) f.append(k, x);
  return f;
};

beforeAll(async () => {
  t = await monitoringDb('views');
  await configureRecipients();
});

afterAll(async () => {
  setAuthProvider(async () => null);
  await t?.close();
});

beforeEach(() => signInAs(PERMISSIONS));

describe('integration cards', () => {
  it('summarises calls per provider over 24 h: error rate, latency, last ok, not configured mode', async () => {
    await integrationCall('wp11mail', 'send', async () => 'ok');
    await integrationCall('wp11mail', 'send', async () => 'ok');
    await integrationCall('wp11mail', 'send', async () => Promise.reject(new Error('quota exceeded')));
    await integrationCall('wp11sms', 'send', async () => Promise.reject(new NotConfiguredError('wp11sms')));
    const cards = await integrationCards();
    const mail = cards.find((c) => c.provider === 'wp11mail')!;
    expect(mail).toMatchObject({ mode: 'live', calls24h: 3, failed24h: 1, lastError: 'quota exceeded' });
    expect(mail.errorRate24h).toBeCloseTo(1 / 3);
    expect(mail.lastOkAt).toBeInstanceOf(Date);
    expect(cards.find((c) => c.provider === 'wp11sms')).toMatchObject({ mode: 'not_configured', calls24h: 0, errorRate24h: null });
  });
});

describe('check history', () => {
  it('hourly ok share, oldest first', async () => {
    const now = new Date('2026-10-20T10:30:00Z');
    await recordCheck('wp11.probe', true, { now: new Date(now.getTime() - minutes(10)) });
    await recordCheck('wp11.probe', false, { now: new Date(now.getTime() - minutes(20)) });
    await recordCheck('wp11.probe', true, { now: new Date(now.getTime() - minutes(130)) });
    const h = await checkHistory('wp11.probe', { hours: 3, now });
    expect(h.hourly).toEqual([1, null, 0.5]); // 2-3 h ago, 1-2 h ago, last hour
    expect(h.okRatio).toBeCloseTo(2 / 3);
  });
});

describe('jobs view', () => {
  it('lists a job that failed every retry (dead letter) and Retry puts it back on its queue', async () => {
    const boss = await getBoss();
    await ensureQueue(boss, 'wp11.flaky', { retryLimit: 0 });
    const id = await boss.send('wp11.flaky', { n: 1 });
    const [job] = await boss.fetch('wp11.flaky');
    expect(job!.id).toBe(id);
    await boss.fail('wp11.flaky', id!, { message: 'upstream said no' });

    const failed = await listFailedJobs();
    const original = failed.find((j) => j.queue === 'wp11.flaky');
    const dead = failed.find((j) => j.queue === 'wp11.flaky.dead');
    expect(original).toMatchObject({ state: 'failed', error: 'upstream said no' });
    expect(dead).toMatchObject({ state: 'created', sourceName: 'wp11.flaky' });
    expect((await listQueues()).find((q) => q.name === 'wp11.flaky')).toMatchObject({ failed: 1, dead: 1 });

    expect(await retryJob({ queue: 'wp11.flaky.dead', id: dead!.id }, STAFF_ID)).toBe(true);
    const { rows } = await t.pool.query("select count(*)::int as n from pgboss.job where name = 'wp11.flaky' and state = 'created'");
    expect(rows[0].n).toBe(1);
    expect((await listQueues()).find((q) => q.name === 'wp11.flaky')).toMatchObject({ waiting: 1, dead: 0 });
  });

  it('Retry on a failed job (no dead letter) re-queues it; the action needs jobs.retry', async () => {
    const boss = await getBoss();
    await ensureQueue(boss, 'wp11.plain', { retryLimit: 0, deadLetter: false });
    const id = (await boss.send('wp11.plain', {}))!;
    await boss.fetch('wp11.plain');
    await boss.fail('wp11.plain', id, { message: 'nope' });

    signInAs(['health.read']);
    await retryJobAction(form({ queue: 'wp11.plain', id }));
    expect((await boss.getJobById('wp11.plain', id))!.state).toBe('failed');

    signInAs(['health.read', 'jobs.retry']);
    await retryJobAction(form({ queue: 'wp11.plain', id }));
    expect((await boss.getJobById('wp11.plain', id))!.state).toBe('retry');
    const { rows } = await t.pool.query("select count(*)::int as n from core_audit_log where action = 'job.retry'");
    expect(rows[0].n).toBeGreaterThanOrEqual(1);
  });
});

describe('admin actions', () => {
  it('ack needs health.read; rule edits need settings.write', async () => {
    const a = await alert({ rule: 'uptime.live', fingerprint: 'act', title: 'Down' }, { now: TEST_NOW });
    signInAs([]);
    await ackAlertAction(form({ id: a!.id }));
    expect((await t.db.select().from(monitoringAlert).where(eq(monitoringAlert.id, a!.id)))[0]!.status).toBe('open');
    signInAs(['health.read']);
    await ackAlertAction(form({ id: a!.id }));
    expect((await t.db.select().from(monitoringAlert).where(eq(monitoringAlert.id, a!.id)))[0]!.status).toBe('acked');

    const ruleForm = form({ key: 'jobs.backlog', severity: 'low', channels: ['email', 'webhook'], dedupeMinutes: '60', repeatMinutes: '', isActive: 'on' });
    await updateRuleAction(ruleForm);
    expect((await getRule('jobs.backlog'))!.severity).toBe('high');
    signInAs(['health.read', 'settings.write']);
    await updateRuleAction(ruleForm);
    expect(await getRule('jobs.backlog')).toMatchObject({ severity: 'low', channels: ['email', 'webhook'], dedupeMinutes: 60, repeatMinutes: null, isActive: true });
    // Unchecked "active" switches the rule off; a bad form changes nothing.
    await updateRuleAction(form({ key: 'jobs.backlog', severity: 'low', dedupeMinutes: '60', repeatMinutes: '' }));
    expect(await getRule('jobs.backlog')).toMatchObject({ isActive: false, channels: [] });
    await updateRuleAction(form({ key: 'jobs.backlog', severity: 'panic', dedupeMinutes: '60' }));
    expect((await getRule('jobs.backlog'))!.severity).toBe('low');
  });

  it('resolve, ignore and reopen an error issue', async () => {
    const id = (await captureError(new Error('views boom'), { route: '/plants' }))!;
    await issueStatusAction(form({ id, status: 'ignored' }));
    expect((await listIssues({ status: 'ignored' })).rows.map((r) => r.id)).toContain(id);
    await issueStatusAction(form({ id, status: 'open' }));
    expect((await listIssues({ status: 'open' })).rows.map((r) => r.id)).toContain(id);
  });
});

describe('screens render', () => {
  it('overview shows checks, uptime, integration cards, workers and the 404 note', async () => {
    await recordCheck('monitoring.database', true, { latencyMs: 3 });
    await recordCheck('monitoring.worker', false, { detail: { status: 'down', detail: 'no worker heartbeat recorded' } });
    const out = await html(HealthOverviewPage({}));
    expect(out).toContain('monitoring.database');
    expect(out).toContain('no worker heartbeat recorded');
    expect(out).toContain('wp11mail');
    expect(out).toContain('No worker has started');
    expect(out).toContain('The 404 log needs the SEO module');
    expect(out).toContain('Run checks now');
  });

  it('alerts screen lists issues with actions and the rules form (editable with settings.write only)', async () => {
    await t.db.execute(sql`truncate monitoring_alert`);
    await alert({ rule: 'uptime.live', fingerprint: 'render', title: 'Render test down' }, { now: TEST_NOW });
    let out = await html(AlertsPage({ searchParams: {} }));
    expect(out).toContain('Render test down');
    expect(out).toContain('Ack');
    expect(out).toContain('uptime.live');
    expect(out).toContain('data-cta="alert-rule-save"');
    signInAs(['health.read']);
    out = await html(AlertsPage({ searchParams: { status: 'resolved' } }));
    expect(out).not.toContain('Render test down');
    expect(out).not.toContain('data-cta="alert-rule-save"');
  });

  it('jobs screen hides Retry without jobs.retry', async () => {
    expect(await html(JobsPage({}))).toContain('data-cta="job-retry"');
    signInAs(['health.read']);
    expect(await html(JobsPage({}))).not.toContain('data-cta="job-retry"');
  });

  it('error detail shows the stack; unknown ids are a 404', async () => {
    const id = (await captureError(new Error('detail boom'), { route: '/plant/[slug]', url: '/plant/x?token=secret' }))!;
    const out = await html(ErrorDetailPage({ id }));
    expect(out).toContain('detail boom');
    expect(out).toContain('/plant/x');
    expect(out).not.toContain('token=secret');
    await expect(ErrorDetailPage({ id: 'not-a-uuid' })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('bell and dashboard widget count open alerts', async () => {
    await t.db.execute(sql`truncate monitoring_alert`);
    expect(await html(AlertBell({}))).toContain('No open alerts');
    await alert({ rule: 'uptime.live', fingerprint: 'bell', title: 'Bell down' }, { now: TEST_NOW });
    expect(await html(AlertBell({}))).toContain('1 open alerts');
    expect(await html(AlertsWidget())).toContain('Bell down');
  });

  it('the route is a 404 for anyone without health.read', async () => {
    signInAs(['orders.read']);
    await expect(AdminHealthRoute()).rejects.toThrow('NEXT_NOT_FOUND');
    signInAs(null);
    await expect(AdminHealthRoute()).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
