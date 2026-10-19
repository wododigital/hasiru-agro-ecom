import { describe, expect, it } from 'vitest';
import {
  alertText,
  channelsToAvoid,
  DEFAULT_RULES,
  diskHealth,
  dnsMissing,
  expiryProblem,
  fallbackRule,
  heartbeatHealth,
  isCriticalRoute,
  monitoringSettingsSchema,
  nextRepeatAt,
  notifyOnOpen,
  overallStatus,
  rdapExpiry,
  splitList,
} from '../src/domain';

const now = new Date('2026-10-20T04:30:00Z');
const mins = (n: number) => new Date(now.getTime() - n * 60_000);

describe('routing decisions', () => {
  it('notifies a new critical or high alert unless it flapped back inside the dedupe window; low waits for the digest', () => {
    expect(notifyOnOpen('critical', null, 30, now)).toBe(true);
    expect(notifyOnOpen('high', mins(10), 30, now)).toBe(false);
    expect(notifyOnOpen('high', mins(30), 30, now)).toBe(true);
    expect(notifyOnOpen('low', null, 30, now)).toBe(false);
  });

  it('repeats only critical alerts', () => {
    expect(nextRepeatAt('critical', 30, now)?.toISOString()).toBe('2026-10-20T05:00:00.000Z');
    expect(nextRepeatAt('high', 30, now)).toBeNull();
    expect(nextRepeatAt('critical', null, now)).toBeNull();
  });

  it('never relies on the channel an alert is about', () => {
    expect(channelsToAvoid('integration.failed', 'gmail:send')).toEqual(['email']);
    expect(channelsToAvoid('integration.failed', 'whatsapp:send')).toEqual(['whatsapp']);
    expect(channelsToAvoid('integration.failed', 'phonepe:status')).toEqual([]);
    expect(channelsToAvoid('messaging.failure-rate', 'email')).toEqual(['whatsapp', 'email']);
    expect(channelsToAvoid('health.down', 'notifications.gmail')).toEqual(['whatsapp', 'email']);
    expect(channelsToAvoid('error.issue', 'gmail-like-fingerprint')).toEqual([]);
  });

  it('treats checkout, pay and webhook routes as critical', () => {
    for (const r of ['/checkout', '/checkout/[orderId]/pay', '/pay/return', '/api/webhooks/phonepe']) expect(isCriticalRoute(r)).toBe(true);
    for (const r of ['/plants', '/api/payment-info', '/paywall', null]) expect(isCriticalRoute(r)).toBe(false);
  });

  it('has defaults per plan: critical repeats every 30 min on WhatsApp + email, persistent rules dedupe for hours', () => {
    expect(DEFAULT_RULES['uptime.live']).toMatchObject({ severity: 'critical', channels: ['whatsapp', 'email'], repeatMinutes: 30 });
    expect(DEFAULT_RULES['ssl.expiry']!.dedupeMinutes).toBe(1440);
    expect(fallbackRule('custom.thing', 'low')).toMatchObject({ severity: 'low', dedupeMinutes: 360, repeatMinutes: null });
  });

  it('formats alert text', () => {
    expect(alertText({ severity: 'critical', title: 'Site down', body: 'HTTP 502', count: 3 }, 'repeat')).toBe('[CRITICAL] Site down (still open, not acked)\nHTTP 502\nSeen 3 times.');
    expect(alertText({ severity: 'high', title: 'X', body: '', count: 1 }, 'resolved')).toBe('Resolved: X');
  });
});

describe('health evaluations', () => {
  it('heartbeat: missing or older than 2 minutes is down', () => {
    expect(heartbeatHealth(null, now).status).toBe('down');
    expect(heartbeatHealth(mins(1), now).status).toBe('ok');
    expect(heartbeatHealth(mins(3), now).status).toBe('down');
  });

  it('disk: under 10% free or not writable is down', () => {
    expect(diskHealth([{ path: '/a', freeBytes: 11, totalBytes: 100, writable: true }]).status).toBe('ok');
    expect(diskHealth([{ path: '/a', freeBytes: 9, totalBytes: 100, writable: true }])).toEqual({ status: 'down', detail: '/a 9% free' });
    expect(diskHealth([{ path: '/b', freeBytes: 90, totalBytes: 100, writable: false }]).detail).toBe('/b not writable');
  });

  it('expiry: certificates under 14 days, domains under 30 days', () => {
    expect(expiryProblem('Cert', new Date('2026-11-10T00:00:00Z'), 14, now)).toBeNull();
    expect(expiryProblem('Cert', new Date('2026-10-30T00:00:00Z'), 14, now)).toBe('Cert expires in 9 days (2026-10-30)');
    expect(expiryProblem('Domain', new Date('2026-11-15T00:00:00Z'), 30, now)).toMatch(/expires in 25 days/);
  });

  it('reads the RDAP expiration event', () => {
    expect(rdapExpiry({ events: [{ eventAction: 'registration', eventDate: '2020-01-01T00:00:00Z' }, { eventAction: 'expiration', eventDate: '2027-01-01T00:00:00Z' }] })?.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(rdapExpiry({})).toBeNull();
    expect(rdapExpiry(null)).toBeNull();
  });

  it('DNS: A, MX, SPF and DMARC must exist', () => {
    expect(dnsMissing({ a: ['1.2.3.4'], mx: ['mx.example.com'], txt: ['v=spf1 include:_spf.example.com ~all'], dmarc: ['v=DMARC1; p=none'] })).toEqual([]);
    expect(dnsMissing({ a: [], mx: [], txt: ['google-site-verification=x'], dmarc: [] })).toEqual(['A', 'MX', 'SPF', 'DMARC']);
  });

  it('overall status: any down is down, any degraded is degraded, not configured counts as ok', () => {
    expect(overallStatus([{ status: 'ok' }, { status: 'not_configured' }])).toBe('ok');
    expect(overallStatus([{ status: 'ok' }, { status: 'degraded' }])).toBe('degraded');
    expect(overallStatus([{ status: 'degraded' }, { status: 'down' }])).toBe('down');
  });

  it('splits admin lists', () => {
    expect(splitList(' a.com, b.com\nc.com ,, ')).toEqual(['a.com', 'b.com', 'c.com']);
  });
});

describe('settings schema', () => {
  it('has safe defaults and validates recipients and the webhook', () => {
    expect(monitoringSettingsSchema.parse({})).toMatchObject({ devEmail: '', fallbackWebhookUrl: '', backupMaxAgeHours: 26, jobBacklogLimit: 500, errorSpikeThreshold: 20 });
    expect(monitoringSettingsSchema.safeParse({ devEmail: 'nope' }).success).toBe(false);
    expect(monitoringSettingsSchema.safeParse({ fallbackWebhookUrl: 'http://hooks.example.com/x' }).success).toBe(false);
    expect(monitoringSettingsSchema.safeParse({ fallbackWebhookUrl: 'https://hooks.example.com/x' }).success).toBe(true);
    expect(monitoringSettingsSchema.safeParse({ selfCheckUrl: 'ftp://x' }).success).toBe(false);
  });
});
