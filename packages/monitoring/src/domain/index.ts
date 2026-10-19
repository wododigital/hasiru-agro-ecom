// Pure monitoring rules: alert routing and dedupe decisions, health evaluations, settings schema. No DB, no React.
import type { HealthResult } from '@ecomkit/core/contracts';
import { z } from 'zod';

export const SEVERITIES = ['critical', 'high', 'low'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const ALERT_CHANNELS = ['whatsapp', 'email', 'webhook'] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];
export const ALERT_STATUSES = ['open', 'acked', 'resolved'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export interface AlertRule {
  key: string;
  severity: Severity;
  channels: readonly AlertChannel[];
  /** A resolved alert that fires again within this window of its last notification stays quiet (flapping). */
  dedupeMinutes: number;
  /** Critical: remind every N minutes until acked. */
  repeatMinutes: number | null;
  isActive: boolean;
}

export const RULE_KEY_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

const rule = (key: string, severity: Severity, dedupeMinutes: number, repeatMinutes: number | null = null): AlertRule => ({
  key,
  severity,
  channels: severity === 'critical' ? ['whatsapp', 'email'] : ['email'],
  dedupeMinutes,
  repeatMinutes,
  isActive: true,
});

/** Defaults used until an admin edits a rule (rows in monitoring_alert_rule win). Transient 30 min, persistent 6 to 24 h. */
export const DEFAULT_RULES: Readonly<Record<string, AlertRule>> = Object.fromEntries(
  [
    rule('error.issue', 'high', 30),
    rule('error.spike', 'high', 30),
    rule('integration.failed', 'high', 360),
    rule('health.down', 'critical', 30, 30),
    rule('health.degraded', 'low', 360),
    rule('jobs.dead-letter', 'high', 360),
    rule('jobs.backlog', 'high', 30),
    rule('uptime.live', 'critical', 30, 30),
    rule('ssl.expiry', 'high', 1440),
    rule('domain.expiry', 'high', 1440),
    rule('dns.records', 'high', 1440),
    rule('backup.stale', 'high', 1440),
    rule('db.connections', 'high', 360),
  ].map((r) => [r.key, r]),
);

/** Rule for a key no default and no row knows: severity-based defaults, so a module can raise its own keys. */
export function fallbackRule(key: string, severity: Severity = 'high'): AlertRule {
  return rule(key, severity, severity === 'low' ? 360 : 30, severity === 'critical' ? 30 : null);
}

export const alertInputSchema = z.object({
  rule: z.string().max(80).regex(RULE_KEY_RE),
  fingerprint: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(300),
  body: z.string().max(4000).default(''),
  /** Overrides the rule severity for this alert (e.g. an error on checkout is critical). */
  severity: z.enum(SEVERITIES).optional(),
});
export type AlertInput = z.input<typeof alertInputSchema>;

export const ruleUpdateSchema = z.object({
  key: z.string().max(80).regex(RULE_KEY_RE),
  severity: z.enum(SEVERITIES),
  channels: z.array(z.enum(ALERT_CHANNELS)).max(3),
  dedupeMinutes: z.coerce.number().int().min(1).max(10_080),
  repeatMinutes: z.coerce.number().int().min(5).max(1440).nullable(),
  isActive: z.boolean(),
});
export type RuleUpdate = z.infer<typeof ruleUpdateSchema>;

const MINUTE = 60_000;

/**
 * Whether a newly opened alert goes out straight away. Low waits for the daily digest. Critical and high go out
 * unless the same rule + fingerprint was notified within the dedupe window (it resolved and came back: flapping).
 */
export function notifyOnOpen(severity: Severity, previousNotifiedAt: Date | null, dedupeMinutes: number, now: Date): boolean {
  if (severity === 'low') return false;
  return !previousNotifiedAt || now.getTime() - previousNotifiedAt.getTime() >= dedupeMinutes * MINUTE;
}

/** Next reminder for an open critical alert; null for every other severity. */
export function nextRepeatAt(severity: Severity, repeatMinutes: number | null, from: Date): Date | null {
  if (severity !== 'critical' || !repeatMinutes) return null;
  return new Date(from.getTime() + repeatMinutes * MINUTE);
}

/**
 * Channels an alert must not rely on because the alert is about them ("alerts never depend only on the integration
 * they report on"). Skipped channels make delivery fall through to the webhook.
 */
export function channelsToAvoid(ruleKey: string, fingerprint: string): AlertChannel[] {
  const subject = (ruleKey === 'integration.failed' ? fingerprint.split(':')[0] : fingerprint)!.toLowerCase();
  if (ruleKey.startsWith('messaging.') || subject.startsWith('notifications')) return ['whatsapp', 'email'];
  if (ruleKey !== 'integration.failed' && ruleKey !== 'health.down' && ruleKey !== 'health.degraded') return [];
  if (/^(gmail|email|smtp)\b/.test(subject)) return ['email'];
  if (/^whatsapp\b/.test(subject)) return ['whatsapp'];
  return [];
}

/** Server errors on money paths are critical. */
export function isCriticalRoute(route: string | null | undefined): boolean {
  return !!route && /^\/(checkout|pay|api\/webhooks)(\/|$)/.test(route);
}

export type DeliveryKind = 'opened' | 'repeat' | 'resolved';

export interface AlertSummary {
  severity: Severity;
  title: string;
  body: string;
  count: number;
}

const SEVERITY_LABEL: Record<Severity, string> = { critical: 'CRITICAL', high: 'HIGH', low: 'LOW' };

/** Plain text for one alert (webhook text, message vars). */
export function alertText(a: AlertSummary, kind: DeliveryKind): string {
  const head = kind === 'resolved' ? `Resolved: ${a.title}` : `[${SEVERITY_LABEL[a.severity]}] ${a.title}${kind === 'repeat' ? ' (still open, not acked)' : ''}`;
  const count = a.count > 1 ? `\nSeen ${a.count} times.` : '';
  return `${head}${a.body ? `\n${a.body}` : ''}${count}`;
}

/** Plain text for a digest of several alerts. */
export function digestText(severity: Severity, alerts: readonly AlertSummary[]): string {
  const lines = alerts.map((a) => `- ${a.title}${a.count > 1 ? ` (x${a.count})` : ''}`);
  return `${SEVERITY_LABEL[severity]} alerts digest: ${alerts.length} open\n${lines.join('\n')}`;
}

// ---- health evaluations ----------------------------------------------------

export const HEARTBEAT_MAX_AGE_MS = 2 * MINUTE;
export const DISK_MIN_FREE_RATIO = 0.1;
export const CERT_MIN_DAYS = 14;
export const DOMAIN_MIN_DAYS = 30;
const DAY = 86_400_000;

export function heartbeatHealth(lastSeen: Date | null, now: Date): HealthResult {
  if (!lastSeen) return { status: 'down', detail: 'no worker heartbeat recorded' };
  const age = now.getTime() - lastSeen.getTime();
  return age > HEARTBEAT_MAX_AGE_MS ? { status: 'down', detail: `last heartbeat ${Math.round(age / 1000)} s ago` } : { status: 'ok' };
}

export function diskHealth(disks: readonly { path: string; freeBytes: number; totalBytes: number; writable: boolean }[]): HealthResult {
  const problems = disks.flatMap((d) => {
    const ratio = d.totalBytes > 0 ? d.freeBytes / d.totalBytes : 0;
    return [...(ratio < DISK_MIN_FREE_RATIO ? [`${d.path} ${Math.round(ratio * 100)}% free`] : []), ...(d.writable ? [] : [`${d.path} not writable`])];
  });
  return problems.length ? { status: 'down', detail: problems.join('; ') } : { status: 'ok' };
}

export const daysUntil = (at: Date, now: Date): number => Math.floor((at.getTime() - now.getTime()) / DAY);

/** Expiry check for a TLS certificate or a domain registration. */
export function expiryProblem(what: string, expiresAt: Date | null, minDays: number, now: Date): string | null {
  if (!expiresAt) return `${what}: expiry unknown`;
  const days = daysUntil(expiresAt, now);
  return days < minDays ? `${what} expires in ${days} days (${expiresAt.toISOString().slice(0, 10)})` : null;
}

/** RDAP domain response -> registration expiry date. */
export function rdapExpiry(json: unknown): Date | null {
  const events = (json as { events?: { eventAction?: string; eventDate?: string }[] } | null)?.events;
  const date = events?.find((e) => e.eventAction === 'expiration')?.eventDate;
  const parsed = date ? new Date(date) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

export interface DnsSnapshot {
  a: readonly string[];
  mx: readonly string[];
  txt: readonly string[];
  dmarc: readonly string[];
}

/** Records a mail-sending store needs: A, MX, SPF, DMARC. Returns what is missing. */
export function dnsMissing(d: DnsSnapshot): string[] {
  return [
    ...(d.a.length ? [] : ['A']),
    ...(d.mx.length ? [] : ['MX']),
    ...(d.txt.some((t) => /^v=spf1\b/i.test(t)) ? [] : ['SPF']),
    ...(d.dmarc.some((t) => /^v=DMARC1\b/i.test(t)) ? [] : ['DMARC']),
  ];
}

/** ok when every check is ok or not configured; down when any readiness check is down; degraded otherwise. */
export function overallStatus(results: readonly { status: HealthResult['status'] }[]): 'ok' | 'degraded' | 'down' {
  if (results.some((r) => r.status === 'down')) return 'down';
  if (results.some((r) => r.status === 'degraded')) return 'degraded';
  return 'ok';
}

/** Comma or newline separated admin list. */
export const splitList = (value: string): string[] =>
  value
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

// ---- settings --------------------------------------------------------------

const optionalEmail = z.union([z.literal(''), z.email()]);
const optionalUrl = (protocols: RegExp) => z.union([z.literal(''), z.url({ protocol: protocols })]);

export const monitoringSettingsSchema = z.object({
  devEmail: optionalEmail.default('').meta({ group: 'Alert recipients', help: 'Developer email for alerts and digests.', placeholder: 'dev@example.com' }),
  devPhone: z
    .string()
    .trim()
    .max(20)
    .default('')
    .meta({ group: 'Alert recipients', help: 'Developer WhatsApp number for critical alerts.', placeholder: '+91 98765 43210' }),
  // A plain string (secret settings must be strings), checked as an https URL when set.
  fallbackWebhookUrl: z
    .string()
    .trim()
    .max(2000)
    .refine((v) => v === '' || (URL.canParse(v) && new URL(v).protocol === 'https:'), 'must be an https URL')
    .default('')
    .meta({
      secret: true,
      group: 'Fallback',
      help: 'HTTPS webhook (chat or push service) used when email and WhatsApp cannot deliver. Receives JSON with text and content fields.',
    }),
  selfCheckUrl: optionalUrl(/^https?$/)
    .default('')
    .meta({ group: 'Checks', help: 'Liveness URL the worker calls every minute. Empty: the internal base URL plus /api/health/live.' }),
  domains: z.string().max(1000).default('').meta({ group: 'Checks', help: 'Domains for the daily certificate, registration and DNS checks, comma separated. Empty: the site URL host.' }),
  diskPaths: z.string().max(1000).default('').meta({ group: 'Checks', help: 'Folders that must stay writable with more than 10% free (uploads, image cache), comma separated. Empty: the app folder.' }),
  backupMaxAgeHours: z.coerce.number().int().min(1).max(168).default(26).meta({ group: 'Checks', help: 'Alert when the last successful backup is older than this.' }),
  jobBacklogLimit: z.coerce.number().int().min(10).max(100_000).default(500).meta({ group: 'Checks', help: 'Alert when one queue holds more waiting jobs than this.' }),
  errorSpikeThreshold: z.coerce.number().int().min(2).max(10_000).default(20).meta({ group: 'Checks', help: 'Alert when one error repeats more than this many times in 10 minutes.' }),
});
export type MonitoringSettings = z.infer<typeof monitoringSettingsSchema>;
