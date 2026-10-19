// Monitoring tables (BUILD-PLAN section 3, "monitoring"). Every table is prefixed monitoring_.
import { newId } from '@ecomkit/core/ids';
import { sql } from 'drizzle-orm';
import { bigserial, boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const monitoringSeverity = pgEnum('monitoring_severity', ['critical', 'high', 'low']);
export const monitoringAlertStatus = pgEnum('monitoring_alert_status', ['open', 'acked', 'resolved']);

/** One row per rule key. Missing rows fall back to DEFAULT_RULES (domain), so a fresh database alerts correctly. */
export const monitoringAlertRule = pgTable('monitoring_alert_rule', {
  id: uuid('id').primaryKey().$defaultFn(newId),
  key: text('key').notNull().unique(),
  severity: monitoringSeverity('severity').notNull(),
  /** whatsapp | email | webhook. The in-admin bell always shows an alert (it is the row itself). */
  channels: text('channels').array().notNull().default(sql`'{}'::text[]`),
  dedupeMinutes: integer('dedupe_minutes').notNull(),
  repeatMinutes: integer('repeat_minutes'),
  isActive: boolean('is_active').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A fingerprinted alert issue. At most one unresolved row per (rule_key, fingerprint): further occurrences add to
 * `count`. Resolved rows stay as history; a new occurrence after resolve opens a new row.
 */
export const monitoringAlert = pgTable(
  'monitoring_alert',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    ruleKey: text('rule_key').notNull(),
    fingerprint: text('fingerprint').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    severity: monitoringSeverity('severity').notNull(),
    status: monitoringAlertStatus('status').notNull().default('open'),
    firstAt: timestamp('first_at', { withTimezone: true }).notNull().defaultNow(),
    lastAt: timestamp('last_at', { withTimezone: true }).notNull().defaultNow(),
    count: integer('count').notNull().default(1),
    ackedBy: uuid('acked_by'),
    ackedAt: timestamp('acked_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    /** Last time this alert went out (immediately, as a repeat or in a digest). Digests pick rows with last_at > notified_at. */
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    /** Critical only: when the next reminder is due while the alert is open and not acked. */
    nextRepeatAt: timestamp('next_repeat_at', { withTimezone: true }),
    /** Provenance of the last delivery: channels used, fallback, errors. */
    delivery: jsonb('delivery'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('monitoring_alert_open_uq').on(t.ruleKey, t.fingerprint).where(sql`${t.status} <> 'resolved'`),
    index('monitoring_alert_status_idx').on(t.status, t.lastAt.desc(), t.id.desc()),
    index('monitoring_alert_repeat_idx').on(t.nextRepeatAt),
    index('monitoring_alert_list_idx').on(t.createdAt.desc(), t.id.desc()),
  ],
);

export const monitoringCheckResult = pgTable(
  'monitoring_check_result',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    check: text('check').notNull(),
    ok: boolean('ok').notNull(),
    latencyMs: integer('latency_ms'),
    detail: jsonb('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('monitoring_check_result_check_idx').on(t.check, t.createdAt.desc()), index('monitoring_check_result_created_idx').on(t.createdAt)],
);
