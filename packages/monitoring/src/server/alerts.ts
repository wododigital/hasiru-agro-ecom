// Alert issues: open, count, notify (with fallback), repeat, digest, ack, resolve. The row is always written first;
// delivery never throws back into the caller.
import { audit } from '@ecomkit/core/audit';
import type { SettingsActionResult, TemplateKey } from '@ecomkit/core/contracts';
import { db } from '@ecomkit/core/db';
import { env } from '@ecomkit/core/env';
import { emit } from '@ecomkit/core/events';
import { createLogger } from '@ecomkit/core/observability';
import { rateLimit } from '@ecomkit/core/rate-limit';
import { and, asc, desc, eq, getTableColumns, inArray, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  alertInputSchema,
  alertText,
  channelsToAvoid,
  DEFAULT_RULES,
  digestText,
  fallbackRule,
  nextRepeatAt,
  notifyOnOpen,
  ruleUpdateSchema,
  type AlertChannel,
  type AlertInput,
  type AlertRule,
  type AlertStatus,
  type DeliveryKind,
  type RuleUpdate,
  type Severity,
} from '../domain';
import { monitoringAlert, monitoringAlertRule } from '../schema';
import { getRuntime } from './runtime';
import { monitoringSettings } from './settings';

export type AlertRow = typeof monitoringAlert.$inferSelect;

const log = createLogger('monitoring');
/** Per channel, per hour (plan section 7). */
export const CHANNEL_LIMIT_PER_HOUR = 20;

export async function getRule(key: string): Promise<AlertRule | null> {
  const [row] = await db.select().from(monitoringAlertRule).where(eq(monitoringAlertRule.key, key));
  if (row) return { key: row.key, severity: row.severity, channels: row.channels as AlertChannel[], dedupeMinutes: row.dedupeMinutes, repeatMinutes: row.repeatMinutes, isActive: row.isActive };
  return DEFAULT_RULES[key] ?? null;
}

// ---- delivery ----------------------------------------------------------------

export interface Delivery {
  at: string;
  kind: DeliveryKind | 'digest';
  sent: string[];
  skipped: string[];
  errors: string[];
  /** True when the webhook carried the alert because the configured channels did not. */
  fallback: boolean;
}

interface Outgoing {
  ruleKey: string;
  fingerprint: string;
  channels: readonly AlertChannel[];
  templateKey: TemplateKey;
  kind: Delivery['kind'];
  text: string;
  vars: Record<string, string | number>;
  now: Date;
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

async function underLimit(channel: string, now: Date): Promise<boolean> {
  try {
    return (await rateLimit(`monitoring-alert:${channel}`, { limit: CHANNEL_LIMIT_PER_HOUR, windowSec: 3600, now })).ok;
  } catch {
    return true; // the limiter lives in the database; an alert about the database must still go out
  }
}

/**
 * Sends through the notifications service (email / WhatsApp to the developer) and falls back to the webhook when
 * nothing went out that way: service missing or failing, no recipient, rate limited, or the alert is about that channel.
 */
async function deliver(out: Outgoing): Promise<Delivery> {
  const settings = await monitoringSettings();
  const avoid = channelsToAvoid(out.ruleKey, out.fingerprint);
  const d: Delivery = { at: out.now.toISOString(), kind: out.kind, sent: [], skipped: [], errors: [], fallback: false };
  const direct = out.channels.filter((c): c is 'email' | 'whatsapp' => c !== 'webhook');
  const sender = direct.length ? await getRuntime().notifications().catch(() => null) : null;

  for (const channel of direct) {
    const to = channel === 'email' ? settings.devEmail : settings.devPhone;
    if (avoid.includes(channel)) d.skipped.push(`${channel}: the alert is about this channel`);
    else if (!to) d.skipped.push(`${channel}: no recipient set`);
    else if (!sender) d.skipped.push(`${channel}: notifications unavailable`);
    else if (!(await underLimit(channel, out.now))) d.skipped.push(`${channel}: hourly limit reached`);
    else {
      try {
        const { messageIds } = await sender.send(out.templateKey, channel === 'email' ? { email: to } : { phone: to }, out.vars, { channel });
        if (messageIds.length) d.sent.push(channel);
        else d.errors.push(`${channel}: nothing was sent`);
      } catch (err) {
        d.errors.push(`${channel}: ${errText(err)}`);
      }
    }
  }

  const wantsWebhook = out.channels.includes('webhook');
  if (wantsWebhook || (direct.length > 0 && d.sent.length === 0)) {
    if (!settings.fallbackWebhookUrl) d.skipped.push('webhook: no URL set');
    else if (!(await underLimit('webhook', out.now))) d.skipped.push('webhook: hourly limit reached');
    else {
      try {
        const res = await getRuntime().postWebhook(settings.fallbackWebhookUrl, { text: out.text, content: out.text, kind: out.kind, rule: out.ruleKey, fingerprint: out.fingerprint, ...out.vars });
        if (res.ok) {
          d.sent.push('webhook');
          d.fallback = !wantsWebhook;
        } else d.errors.push(`webhook: HTTP ${res.status}`);
      } catch (err) {
        d.errors.push(`webhook: ${errText(err)}`);
      }
    }
  }
  if (!d.sent.length) log.error('alert not delivered beyond the admin bell', { rule: out.ruleKey, fingerprint: out.fingerprint, text: out.text, ...d });
  return d;
}

function adminUrl(path: string): string {
  const base = env.SITE_URL ?? env.INTERNAL_BASE_URL;
  return new URL(path, base).toString();
}

async function deliverAlert(row: AlertRow, rule: AlertRule, kind: DeliveryKind, now: Date): Promise<Delivery> {
  const text = alertText(row, kind);
  return deliver({
    ruleKey: row.ruleKey,
    fingerprint: row.fingerprint,
    channels: rule.channels,
    templateKey: 'alert.critical',
    kind,
    text,
    now,
    vars: { text, title: row.title, body: row.body, severity: row.severity, count: row.count, status: kind === 'resolved' ? 'resolved' : row.status, url: adminUrl('/admin/health/alerts') },
  });
}

async function markNotified(row: AlertRow, rule: AlertRule, delivery: Delivery, now: Date): Promise<AlertRow> {
  const [updated] = await db
    .update(monitoringAlert)
    .set({ notifiedAt: now, delivery, nextRepeatAt: row.status === 'open' ? nextRepeatAt(row.severity, rule.repeatMinutes, now) : null })
    .where(eq(monitoringAlert.id, row.id))
    .returning();
  return updated ?? row;
}

// ---- raise / resolve / ack ---------------------------------------------------

/**
 * Raises (or counts) the alert issue for `rule` + `fingerprint`. A new issue notifies straight away for critical
 * and high (unless it flapped back within the rule's dedupe window); further occurrences only add to the count and
 * reach the developer through repeats (critical) or digests (high, low). Returns null when the rule is switched off.
 */
export async function alert(input: AlertInput, options: { now?: Date } = {}): Promise<AlertRow | null> {
  const a = alertInputSchema.parse(input);
  const now = options.now ?? new Date();
  const rule = (await getRule(a.rule)) ?? fallbackRule(a.rule, a.severity);
  if (!rule.isActive) return null;
  const severity = a.severity ?? rule.severity;

  const [row] = await db
    .insert(monitoringAlert)
    .values({ ruleKey: a.rule, fingerprint: a.fingerprint, title: a.title, body: a.body, severity, firstAt: now, lastAt: now, createdAt: now })
    .onConflictDoUpdate({
      target: [monitoringAlert.ruleKey, monitoringAlert.fingerprint],
      targetWhere: sql`${monitoringAlert.status} <> 'resolved'`,
      set: { count: sql`${monitoringAlert.count} + 1`, lastAt: now, title: a.title, body: a.body },
    })
    .returning({ ...getTableColumns(monitoringAlert), inserted: sql<boolean>`(xmax = 0)` });
  const { inserted, ...alertRow } = row!;
  if (!inserted) return alertRow;

  try {
    await emit('alert.raised', { alertId: alertRow.id, severity, fingerprint: a.fingerprint });
  } catch (err) {
    log.warn('alert.raised not emitted', { error: errText(err) });
  }

  const [previous] = await db
    .select({ notifiedAt: monitoringAlert.notifiedAt })
    .from(monitoringAlert)
    .where(and(eq(monitoringAlert.ruleKey, a.rule), eq(monitoringAlert.fingerprint, a.fingerprint), eq(monitoringAlert.status, 'resolved')))
    .orderBy(desc(monitoringAlert.resolvedAt))
    .limit(1);
  const lastNotified = previous?.notifiedAt ?? null;

  if (notifyOnOpen(severity, lastNotified, rule.dedupeMinutes, now)) {
    return markNotified(alertRow, rule, await deliverAlert(alertRow, rule, 'opened', now), now);
  }
  // Flapping: stay quiet now, but a critical alert still reminds on its usual cadence.
  const repeat = nextRepeatAt(severity, rule.repeatMinutes, lastNotified ?? now);
  if (repeat) await db.update(monitoringAlert).set({ nextRepeatAt: repeat }).where(eq(monitoringAlert.id, alertRow.id));
  return { ...alertRow, nextRepeatAt: repeat };
}

async function resolveWhere(where: SQL, now: Date, actorId: string | null): Promise<AlertRow[]> {
  const rows = await db
    .update(monitoringAlert)
    .set({ status: 'resolved', resolvedAt: now, nextRepeatAt: null })
    .where(and(where, ne(monitoringAlert.status, 'resolved')))
    .returning();
  for (const row of rows) {
    if (actorId) await audit({ actorId, actorType: 'staff', action: 'alert.resolve', entity: 'monitoring_alert', entityId: row.id });
    // "Resolved" notice for anything the developer was told about.
    if (row.notifiedAt && row.severity !== 'low') {
      const rule = (await getRule(row.ruleKey)) ?? fallbackRule(row.ruleKey, row.severity);
      const delivery = await deliverAlert(row, rule, 'resolved', now);
      await db.update(monitoringAlert).set({ delivery }).where(eq(monitoringAlert.id, row.id));
    }
  }
  return rows;
}

/** The condition cleared: resolves the unresolved issue for rule + fingerprint (if any) and sends the resolved notice. */
export async function resolveAlert(ruleKey: string, fingerprint: string, options: { now?: Date } = {}): Promise<AlertRow | null> {
  const [row] = await resolveWhere(and(eq(monitoringAlert.ruleKey, ruleKey), eq(monitoringAlert.fingerprint, fingerprint))!, options.now ?? new Date(), null);
  return row ?? null;
}

/** Admin resolve by id. */
export async function resolveAlertById(id: string, actorId: string, options: { now?: Date } = {}): Promise<AlertRow | null> {
  const [row] = await resolveWhere(eq(monitoringAlert.id, id), options.now ?? new Date(), actorId);
  return row ?? null;
}

/** Acknowledge: stops critical repeats; the issue stays visible until it resolves. */
export async function ackIssue(alertId: string, actorId: string, options: { now?: Date } = {}): Promise<AlertRow | null> {
  const now = options.now ?? new Date();
  const [row] = await db
    .update(monitoringAlert)
    .set({ status: 'acked', ackedBy: actorId, ackedAt: now, nextRepeatAt: null })
    .where(and(eq(monitoringAlert.id, alertId), eq(monitoringAlert.status, 'open')))
    .returning();
  if (row) await audit({ actorId, actorType: 'staff', action: 'alert.ack', entity: 'monitoring_alert', entityId: row.id });
  return row ?? null;
}

export interface ActiveCondition {
  fingerprint: string;
  title: string;
  body?: string;
  severity?: Severity;
}

/**
 * Makes the unresolved issues of a rule match the conditions a scan sees right now: raises what is new, resolves
 * what cleared, leaves continuing issues alone (a scan every minute must not inflate counts or notify again).
 */
export async function reconcile(ruleKey: string, active: readonly ActiveCondition[], options: { now?: Date } = {}): Promise<{ raised: number; resolved: number }> {
  const now = options.now ?? new Date();
  const open = await db
    .select({ fingerprint: monitoringAlert.fingerprint })
    .from(monitoringAlert)
    .where(and(eq(monitoringAlert.ruleKey, ruleKey), ne(monitoringAlert.status, 'resolved')));
  const openSet = new Set(open.map((o) => o.fingerprint));
  const activeSet = new Set(active.map((a) => a.fingerprint));
  let raised = 0;
  for (const c of active) {
    if (openSet.has(c.fingerprint)) continue;
    if (await alert({ rule: ruleKey, fingerprint: c.fingerprint, title: c.title, body: c.body ?? '', severity: c.severity }, { now })) raised++;
  }
  const cleared = [...openSet].filter((fp) => !activeSet.has(fp));
  const resolved = cleared.length
    ? (await resolveWhere(and(eq(monitoringAlert.ruleKey, ruleKey), inArray(monitoringAlert.fingerprint, cleared))!, now, null)).length
    : 0;
  return { raised, resolved };
}

// ---- repeats and digests -----------------------------------------------------

/** Critical issues still open and not acked get a reminder every rule.repeatMinutes. */
export async function sendRepeats(options: { now?: Date } = {}): Promise<number> {
  const now = options.now ?? new Date();
  const due = await db
    .select()
    .from(monitoringAlert)
    .where(and(eq(monitoringAlert.status, 'open'), eq(monitoringAlert.severity, 'critical'), lte(monitoringAlert.nextRepeatAt, now)))
    .orderBy(asc(monitoringAlert.nextRepeatAt))
    .limit(100);
  for (const row of due) {
    const rule = (await getRule(row.ruleKey)) ?? fallbackRule(row.ruleKey, row.severity);
    await markNotified(row, rule, await deliverAlert(row, rule, 'repeat', now), now);
  }
  return due.length;
}

/**
 * One message listing the unresolved issues of a severity with activity since they were last notified
 * (high: hourly, low: daily at 09:00 IST). Returns how many issues it covered.
 */
export async function sendDigest(severity: Severity, options: { now?: Date } = {}): Promise<number> {
  const now = options.now ?? new Date();
  const rows = await db
    .select()
    .from(monitoringAlert)
    .where(
      and(
        eq(monitoringAlert.severity, severity),
        ne(monitoringAlert.status, 'resolved'),
        or(isNull(monitoringAlert.notifiedAt), sql`${monitoringAlert.lastAt} > ${monitoringAlert.notifiedAt}`),
      ),
    )
    .orderBy(desc(monitoringAlert.lastAt))
    .limit(50);
  if (!rows.length) return 0;
  const rules = await Promise.all([...new Set(rows.map((r) => r.ruleKey))].map(async (k) => (await getRule(k)) ?? fallbackRule(k, severity)));
  const channels = [...new Set(rules.filter((r) => r.isActive).flatMap((r) => r.channels))];
  const text = digestText(severity, rows);
  const delivery = await deliver({
    ruleKey: 'digest',
    fingerprint: severity,
    channels,
    templateKey: 'alert.digest',
    kind: 'digest',
    text,
    now,
    vars: { text, severity, count: rows.length, url: adminUrl('/admin/health/alerts') },
  });
  await db
    .update(monitoringAlert)
    .set({ notifiedAt: now, delivery })
    .where(inArray(monitoringAlert.id, rows.map((r) => r.id)));
  return rows.length;
}

/** Settings action: one message through every alert channel (no alert row), so the developer can see the route works. */
export async function sendTestAlert(ctx: { actorId: string }): Promise<SettingsActionResult> {
  const text = 'Test alert from the store. If you can read this, alerts reach you.';
  const d = await deliver({ ruleKey: 'monitoring.test', fingerprint: 'test', channels: ['whatsapp', 'email', 'webhook'], templateKey: 'test.send', kind: 'opened', text, now: new Date(), vars: { text, title: 'Test alert', body: '', severity: 'low', count: 1, status: 'open', url: adminUrl('/admin/health/alerts') } });
  await audit({ actorId: ctx.actorId, actorType: 'staff', action: 'alert.test', entity: 'monitoring_alert', entityId: 'test', after: d });
  return d.sent.length
    ? { ok: true, message: `Sent through ${d.sent.join(', ')}.`, detail: { ...d } }
    : { ok: false, message: `Nothing was sent. ${[...d.skipped, ...d.errors].join('; ')}`, detail: { ...d } };
}

// ---- reads for the admin -----------------------------------------------------

export async function listAlerts(options: { status?: AlertStatus | 'unresolved'; severity?: Severity; page?: number; pageSize?: number } = {}): Promise<{ rows: AlertRow[]; total: number }> {
  const pageSize = options.pageSize ?? 50;
  const where = and(
    options.status === 'unresolved' ? ne(monitoringAlert.status, 'resolved') : options.status ? eq(monitoringAlert.status, options.status) : undefined,
    options.severity ? eq(monitoringAlert.severity, options.severity) : undefined,
  );
  const [rows, [count]] = await Promise.all([
    db
      .select()
      .from(monitoringAlert)
      .where(where)
      .orderBy(desc(monitoringAlert.lastAt), desc(monitoringAlert.id))
      .limit(pageSize)
      .offset(((options.page ?? 1) - 1) * pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(monitoringAlert).where(where),
  ]);
  return { rows, total: count?.n ?? 0 };
}

export interface BellCounts {
  /** Open and not acked, by severity. */
  open: Record<Severity, number>;
  acked: number;
  total: number;
}

/** Numbers for the in-admin bell. */
export async function bellCounts(): Promise<BellCounts> {
  const rows = await db
    .select({ severity: monitoringAlert.severity, status: monitoringAlert.status, n: sql<number>`count(*)::int` })
    .from(monitoringAlert)
    .where(ne(monitoringAlert.status, 'resolved'))
    .groupBy(monitoringAlert.severity, monitoringAlert.status);
  const out: BellCounts = { open: { critical: 0, high: 0, low: 0 }, acked: 0, total: 0 };
  for (const r of rows) {
    if (r.status === 'open') out.open[r.severity] += r.n;
    else out.acked += r.n;
    out.total += r.n;
  }
  return out;
}

/** Every rule in effect: stored rows plus defaults nobody has edited. */
export async function listRules(): Promise<(AlertRule & { stored: boolean })[]> {
  const rows = await db.select().from(monitoringAlertRule);
  const stored = new Map(rows.map((r) => [r.key, r]));
  const keys = [...new Set([...Object.keys(DEFAULT_RULES), ...stored.keys()])].sort();
  return keys.map((key) => {
    const r = stored.get(key);
    return r
      ? { key, severity: r.severity, channels: r.channels as AlertChannel[], dedupeMinutes: r.dedupeMinutes, repeatMinutes: r.repeatMinutes, isActive: r.isActive, stored: true }
      : { ...DEFAULT_RULES[key]!, stored: false };
  });
}

export async function updateRule(input: RuleUpdate, actorId: string | null): Promise<void> {
  const r = ruleUpdateSchema.parse(input);
  const before = await getRule(r.key);
  const values = { severity: r.severity, channels: [...new Set(r.channels)], dedupeMinutes: r.dedupeMinutes, repeatMinutes: r.repeatMinutes, isActive: r.isActive, updatedAt: new Date() };
  await db.insert(monitoringAlertRule).values({ key: r.key, ...values }).onConflictDoUpdate({ target: monitoringAlertRule.key, set: values });
  await audit({ actorId, actorType: actorId ? 'staff' : 'system', action: 'alert_rule.update', entity: 'monitoring_alert_rule', entityId: r.key, before, after: values });
}
