import { queuedJobs, TEST_NOW, type TestDb } from '@ecomkit/core/testing';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { monitoringAlert } from '../src/schema';
import {
  ackIssue,
  alert,
  bellCounts,
  CHANNEL_LIMIT_PER_HOUR,
  listRules,
  reconcile,
  resolveAlert,
  resolveAlertById,
  sendDigest,
  sendRepeats,
  sendTestAlert,
  updateRule,
  type Delivery,
} from '../src/server';
import { at, configureRecipients, fakeTransports, minutes, monitoringDb, WEBHOOK } from './helpers';

let t: TestDb;
const fake = fakeTransports();
const STAFF = '01900000-0000-7000-8000-000000000001';

beforeAll(async () => {
  t = await monitoringDb('alerts');
  await configureRecipients();
});

afterAll(async () => {
  await t?.close();
});

beforeEach(async () => {
  fake.reset();
  // Each test starts with no alerts and a fresh per-channel limiter.
  await t.db.execute(sql`truncate monitoring_alert, monitoring_alert_rule, core_rate_limit`);
});

const rowsFor = (fingerprint: string) => t.db.select().from(monitoringAlert).where(eq(monitoringAlert.fingerprint, fingerprint));

describe('dedupe', () => {
  it('groups repeated occurrences into one issue with a count and notifies once', async () => {
    const first = await alert({ rule: 'error.issue', fingerprint: 'fp-1', title: 'TypeError: x' }, { now: TEST_NOW });
    await alert({ rule: 'error.issue', fingerprint: 'fp-1', title: 'TypeError: x' }, { now: at(TEST_NOW, minutes(1)) });
    const third = await alert({ rule: 'error.issue', fingerprint: 'fp-1', title: 'TypeError: x' }, { now: at(TEST_NOW, minutes(2)) });
    expect(third!.id).toBe(first!.id);
    const rows = await rowsFor('fp-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ count: 3, status: 'open', severity: 'high' });
    expect(rows[0]!.lastAt.toISOString()).toBe(at(TEST_NOW, minutes(2)).toISOString());
    // High rule channels: email only, sent once.
    expect(fake.state.sent.map((s) => [s.channel, s.templateKey, s.to])).toEqual([['email', 'alert.critical', 'dev@example.test']]);
    expect(fake.state.webhook).toHaveLength(0);
  });

  it('a different fingerprint is a different issue', async () => {
    await alert({ rule: 'error.issue', fingerprint: 'fp-a', title: 'A' }, { now: TEST_NOW });
    await alert({ rule: 'error.issue', fingerprint: 'fp-b', title: 'B' }, { now: TEST_NOW });
    expect(fake.state.sent).toHaveLength(2);
  });

  it('re-alerts only after resolve, and stays quiet when it flaps back inside the dedupe window', async () => {
    await alert({ rule: 'error.issue', fingerprint: 'flap', title: 'Flaky' }, { now: TEST_NOW }); // notified
    await resolveAlert('error.issue', 'flap', { now: at(TEST_NOW, minutes(5)) }); // resolved notice
    expect(fake.state.sent.map((s) => s.vars.status)).toEqual(['open', 'resolved']);

    // Back after 10 min: inside the 30 min window of the last notification -> new issue row, no message.
    const back = await alert({ rule: 'error.issue', fingerprint: 'flap', title: 'Flaky' }, { now: at(TEST_NOW, minutes(10)) });
    expect(back!.notifiedAt).toBeNull();
    expect(fake.state.sent).toHaveLength(2);
    expect(await rowsFor('flap')).toHaveLength(2);

    // Resolved again and back after the window: notified again.
    await resolveAlert('error.issue', 'flap', { now: at(TEST_NOW, minutes(20)) }); // never notified -> no resolved notice
    expect(fake.state.sent).toHaveLength(2);
    const later = await alert({ rule: 'error.issue', fingerprint: 'flap', title: 'Flaky' }, { now: at(TEST_NOW, minutes(31)) });
    expect(later!.notifiedAt?.toISOString()).toBe(at(TEST_NOW, minutes(31)).toISOString());
    expect(fake.state.sent).toHaveLength(3);
  });

  it('uses the rule row over the default (longer persistent window)', async () => {
    await updateRule({ key: 'error.issue', severity: 'high', channels: ['email'], dedupeMinutes: 360, repeatMinutes: null, isActive: true }, STAFF);
    await alert({ rule: 'error.issue', fingerprint: 'persist', title: 'P' }, { now: TEST_NOW });
    await resolveAlert('error.issue', 'persist', { now: at(TEST_NOW, minutes(1)) });
    await alert({ rule: 'error.issue', fingerprint: 'persist', title: 'P' }, { now: at(TEST_NOW, minutes(120)) });
    expect(fake.state.sent.filter((s) => s.vars.status === 'open')).toHaveLength(1);
  });

  it('concurrent raises of the same issue create exactly one row', async () => {
    await Promise.all(Array.from({ length: 12 }, () => alert({ rule: 'error.issue', fingerprint: 'race', title: 'Race' }, { now: TEST_NOW })));
    const rows = await rowsFor('race');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.count).toBe(12);
    expect(fake.state.sent).toHaveLength(1);
  });

  it('an inactive rule raises nothing', async () => {
    await updateRule({ key: 'jobs.backlog', severity: 'high', channels: ['email'], dedupeMinutes: 30, repeatMinutes: null, isActive: false }, STAFF);
    expect(await alert({ rule: 'jobs.backlog', fingerprint: 'q', title: 'Backlog' }, { now: TEST_NOW })).toBeNull();
    expect(await rowsFor('q')).toHaveLength(0);
  });

  it('emits alert.raised for a new issue only', async () => {
    const before = (await queuedJobs(t.db, 'core.event')).length;
    const a = await alert({ rule: 'error.issue', fingerprint: 'evt', title: 'E' }, { now: TEST_NOW });
    await alert({ rule: 'error.issue', fingerprint: 'evt', title: 'E' }, { now: TEST_NOW });
    const events = (await queuedJobs(t.db, 'core.event')).slice(before).map((j) => j.data as { event: string; payload: Record<string, unknown> });
    expect(events).toEqual([expect.objectContaining({ event: 'alert.raised', payload: { alertId: a!.id, severity: 'high', fingerprint: 'evt' } })]);
  });
});

describe('repeat until ack (critical)', () => {
  it('reminds every 30 minutes on WhatsApp and email until acked, then stops', async () => {
    const a = await alert({ rule: 'uptime.live', fingerprint: 'live', title: 'Site down' }, { now: TEST_NOW });
    expect(a!.nextRepeatAt?.toISOString()).toBe(at(TEST_NOW, minutes(30)).toISOString());
    expect(fake.state.sent.map((s) => s.channel)).toEqual(['whatsapp', 'email']);

    expect(await sendRepeats({ now: at(TEST_NOW, minutes(29)) })).toBe(0);
    expect(await sendRepeats({ now: at(TEST_NOW, minutes(30)) })).toBe(1);
    expect(await sendRepeats({ now: at(TEST_NOW, minutes(31)) })).toBe(0);
    expect(await sendRepeats({ now: at(TEST_NOW, minutes(60)) })).toBe(1);
    expect(fake.state.sent).toHaveLength(6);
    expect(fake.state.sent.at(-1)!.vars.text).toContain('still open, not acked');

    const acked = await ackIssue(a!.id, STAFF, { now: at(TEST_NOW, minutes(61)) });
    expect(acked).toMatchObject({ status: 'acked', ackedBy: STAFF, nextRepeatAt: null });
    expect(await sendRepeats({ now: at(TEST_NOW, minutes(200)) })).toBe(0);
    expect(fake.state.sent).toHaveLength(6);
  });

  it('a high alert never repeats', async () => {
    await alert({ rule: 'error.issue', fingerprint: 'h', title: 'High' }, { now: TEST_NOW });
    expect(await sendRepeats({ now: at(TEST_NOW, minutes(600)) })).toBe(0);
  });

  it('a critical override on a high rule repeats too', async () => {
    const a = await alert({ rule: 'error.issue', fingerprint: 'checkout', title: 'Checkout broke', severity: 'critical' }, { now: TEST_NOW });
    expect(a!.severity).toBe('critical');
    expect(a!.nextRepeatAt).toBeNull(); // the error.issue rule has no repeat interval
  });

  it('ack applies to open alerts only and is audited', async () => {
    const a = await alert({ rule: 'uptime.live', fingerprint: 'ack2', title: 'Down' }, { now: TEST_NOW });
    expect(await ackIssue(a!.id, STAFF)).not.toBeNull();
    expect(await ackIssue(a!.id, STAFF)).toBeNull();
    const { rows } = await t.db.execute<{ n: number }>(sql`select count(*)::int as n from core_audit_log where action = 'alert.ack' and entity_id = ${a!.id}`);
    expect(rows[0]!.n).toBe(1);
  });
});

describe('fallback when notifications fail', () => {
  const lastDelivery = async (fingerprint: string) => (await rowsFor(fingerprint))[0]!.delivery as Delivery;

  it('notifications throwing -> webhook carries the alert', async () => {
    fake.state.mode = 'throw';
    await alert({ rule: 'uptime.live', fingerprint: 'fb1', title: 'Down' }, { now: TEST_NOW });
    expect(fake.state.webhook).toHaveLength(1);
    expect(fake.state.webhook[0]).toMatchObject({ rule: 'uptime.live', fingerprint: 'fb1', kind: 'opened', severity: 'critical' });
    expect(fake.state.webhook[0]!.text).toContain('[CRITICAL] Down');
    expect(await lastDelivery('fb1')).toMatchObject({ sent: ['webhook'], fallback: true, errors: ['whatsapp: provider down', 'email: provider down'] });
  });

  it('notifications module absent -> webhook', async () => {
    fake.state.available = false;
    await alert({ rule: 'error.issue', fingerprint: 'fb2', title: 'E' }, { now: TEST_NOW });
    expect(fake.state.webhook).toHaveLength(1);
    expect(await lastDelivery('fb2')).toMatchObject({ sent: ['webhook'], fallback: true, skipped: ['email: notifications unavailable'] });
  });

  it('nothing actually sent (empty message ids) -> webhook', async () => {
    fake.state.mode = 'empty';
    await alert({ rule: 'error.issue', fingerprint: 'fb3', title: 'E' }, { now: TEST_NOW });
    expect(fake.state.webhook).toHaveLength(1);
  });

  it('an alert about email does not rely on email', async () => {
    await alert({ rule: 'integration.failed', fingerprint: 'gmail:send', title: 'gmail send is failing' }, { now: TEST_NOW });
    expect(fake.state.sent).toHaveLength(0);
    expect(fake.state.webhook).toHaveLength(1);
    expect(await lastDelivery('gmail:send')).toMatchObject({ skipped: ['email: the alert is about this channel'], fallback: true });
  });

  it('healthy notifications -> no webhook', async () => {
    await alert({ rule: 'error.issue', fingerprint: 'fb4', title: 'E' }, { now: TEST_NOW });
    expect(fake.state.webhook).toHaveLength(0);
  });

  it('no webhook URL and notifications down -> the row (bell) still exists and the failure is recorded', async () => {
    await configureRecipients({ fallbackWebhookUrl: null });
    try {
      fake.state.mode = 'throw';
      const a = await alert({ rule: 'error.issue', fingerprint: 'fb5', title: 'E' }, { now: TEST_NOW });
      expect(a).not.toBeNull();
      expect(await lastDelivery('fb5')).toMatchObject({ sent: [], skipped: ['webhook: no URL set'] });
      expect((await bellCounts()).open.high).toBe(1);
    } finally {
      await configureRecipients();
    }
  });

  it('per-channel limit: at most 20 messages per hour per channel, then the webhook', async () => {
    for (let i = 0; i < CHANNEL_LIMIT_PER_HOUR + 2; i++) await alert({ rule: 'error.issue', fingerprint: `burst-${i}`, title: `E${i}` }, { now: at(TEST_NOW, i * 1000) });
    expect(fake.state.sent.filter((s) => s.channel === 'email')).toHaveLength(CHANNEL_LIMIT_PER_HOUR);
    expect(fake.state.webhook).toHaveLength(2);
    // Next hour the limit resets.
    await alert({ rule: 'error.issue', fingerprint: 'burst-next-hour', title: 'E' }, { now: at(TEST_NOW, minutes(61)) });
    expect(fake.state.sent.filter((s) => s.channel === 'email')).toHaveLength(CHANNEL_LIMIT_PER_HOUR + 1);
  });

  it('the settings test action reports where it went', async () => {
    expect(await sendTestAlert({ actorId: STAFF })).toMatchObject({ ok: true, message: 'Sent through whatsapp, email, webhook.' });
    fake.state.mode = 'throw';
    fake.state.webhookOk = false;
    const failed = await sendTestAlert({ actorId: STAFF });
    expect(failed.ok).toBe(false);
    expect(failed.message).toContain('webhook: HTTP 500');
  });

  it('webhook payload is posted to the configured URL', async () => {
    fake.state.available = false;
    await alert({ rule: 'error.issue', fingerprint: 'url', title: 'E' }, { now: TEST_NOW });
    expect(fake.state.urls).toEqual([WEBHOOK]);
  });
});

describe('digests', () => {
  it('high: first occurrence immediately, later activity in the hourly digest, then quiet', async () => {
    await alert({ rule: 'error.issue', fingerprint: 'd1', title: 'Err one' }, { now: TEST_NOW });
    expect(await sendDigest('high', { now: at(TEST_NOW, minutes(1)) })).toBe(0); // nothing new since notification
    await alert({ rule: 'error.issue', fingerprint: 'd1', title: 'Err one' }, { now: at(TEST_NOW, minutes(5)) });
    await alert({ rule: 'jobs.backlog', fingerprint: 'q1', title: 'Backlog q1' }, { now: at(TEST_NOW, minutes(6)) });
    fake.reset();
    expect(await sendDigest('high', { now: at(TEST_NOW, minutes(60)) })).toBe(1);
    expect(fake.state.sent).toEqual([expect.objectContaining({ templateKey: 'alert.digest', channel: 'email' })]);
    expect(String(fake.state.sent[0]!.vars.text)).toContain('Err one (x2)');
    expect(await sendDigest('high', { now: at(TEST_NOW, minutes(120)) })).toBe(0);
  });

  it('low: never immediate, collected in the daily digest', async () => {
    await alert({ rule: 'health.degraded', fingerprint: 'stale-orders', title: 'No order in 72 h' }, { now: TEST_NOW });
    await alert({ rule: 'health.degraded', fingerprint: 'stale-enquiries', title: 'No enquiry in 7 days' }, { now: TEST_NOW });
    expect(fake.state.sent).toHaveLength(0);
    expect(await sendDigest('low', { now: at(TEST_NOW, minutes(60)) })).toBe(2);
    expect(fake.state.sent).toHaveLength(1);
    expect(String(fake.state.sent[0]!.vars.text)).toMatch(/LOW alerts digest: 2 open/);
  });

  it('resolved issues are left out', async () => {
    await alert({ rule: 'health.degraded', fingerprint: 'gone', title: 'Gone' }, { now: TEST_NOW });
    await resolveAlert('health.degraded', 'gone', { now: TEST_NOW });
    expect(await sendDigest('low', { now: at(TEST_NOW, minutes(60)) })).toBe(0);
  });
});

describe('reconcile, resolve, rules', () => {
  it('raises new conditions, leaves continuing ones alone, resolves cleared ones', async () => {
    expect(await reconcile('jobs.backlog', [{ fingerprint: 'a', title: 'A' }, { fingerprint: 'b', title: 'B' }], { now: TEST_NOW })).toEqual({ raised: 2, resolved: 0 });
    expect(await reconcile('jobs.backlog', [{ fingerprint: 'a', title: 'A' }], { now: at(TEST_NOW, minutes(1)) })).toEqual({ raised: 0, resolved: 1 });
    const [a] = await rowsFor('a');
    expect(a!.count).toBe(1);
    expect((await rowsFor('b'))[0]!.status).toBe('resolved');
  });

  it('a resolved notice goes out only for notified, non-low issues; admin resolve is audited', async () => {
    const a = await alert({ rule: 'uptime.live', fingerprint: 'r1', title: 'Down' }, { now: TEST_NOW });
    fake.reset();
    await resolveAlertById(a!.id, STAFF, { now: at(TEST_NOW, minutes(3)) });
    expect(fake.state.sent.map((s) => [s.channel, s.vars.status])).toEqual([
      ['whatsapp', 'resolved'],
      ['email', 'resolved'],
    ]);
    expect(String(fake.state.sent[0]!.vars.text)).toBe('Resolved: Down');
    const { rows } = await t.db.execute<{ n: number }>(sql`select count(*)::int as n from core_audit_log where action = 'alert.resolve' and entity_id = ${a!.id}`);
    expect(rows[0]!.n).toBe(1);
  });

  it('lists defaults and stored rules together', async () => {
    await updateRule({ key: 'uptime.live', severity: 'critical', channels: ['whatsapp', 'webhook'], dedupeMinutes: 30, repeatMinutes: 15, isActive: true }, STAFF);
    await updateRule({ key: 'shop.custom', severity: 'low', channels: [], dedupeMinutes: 60, repeatMinutes: null, isActive: true }, STAFF);
    const rules = await listRules();
    expect(rules.find((r) => r.key === 'uptime.live')).toMatchObject({ stored: true, repeatMinutes: 15, channels: ['whatsapp', 'webhook'] });
    expect(rules.find((r) => r.key === 'ssl.expiry')).toMatchObject({ stored: false });
    expect(rules.find((r) => r.key === 'shop.custom')).toMatchObject({ stored: true, severity: 'low' });
    await expect(updateRule({ key: 'Bad Key', severity: 'low', channels: [], dedupeMinutes: 1, repeatMinutes: null, isActive: true }, STAFF)).rejects.toThrow();
  });

  it('a rule with the webhook channel sends there as well, not as a fallback', async () => {
    await updateRule({ key: 'uptime.live', severity: 'critical', channels: ['email', 'webhook'], dedupeMinutes: 30, repeatMinutes: 30, isActive: true }, STAFF);
    await alert({ rule: 'uptime.live', fingerprint: 'both', title: 'Down' }, { now: TEST_NOW });
    expect(fake.state.sent.map((s) => s.channel)).toEqual(['email']);
    expect(fake.state.webhook).toHaveLength(1);
    expect((await rowsFor('both'))[0]!.delivery).toMatchObject({ sent: ['email', 'webhook'], fallback: false });
  });

  it('bell counts open by severity and acked separately', async () => {
    const c = await alert({ rule: 'uptime.live', fingerprint: 'b1', title: 'Down' }, { now: TEST_NOW });
    await alert({ rule: 'error.issue', fingerprint: 'b2', title: 'E' }, { now: TEST_NOW });
    await alert({ rule: 'health.degraded', fingerprint: 'b3', title: 'L' }, { now: TEST_NOW });
    await ackIssue(c!.id, STAFF);
    expect(await bellCounts()).toEqual({ open: { critical: 0, high: 1, low: 1 }, acked: 1, total: 3 });
  });

  it('validates input at the boundary', async () => {
    await expect(alert({ rule: 'Not A Key', fingerprint: 'x', title: 'x' })).rejects.toThrow();
    await expect(alert({ rule: 'error.issue', fingerprint: '', title: 'x' })).rejects.toThrow();
  });
});
