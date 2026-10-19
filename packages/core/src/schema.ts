// Core tables (BUILD-PLAN section 3, "core"). Every table is prefixed core_.
// Two things Drizzle cannot express and the migration must add (see README "Migration notes"):
// core_rate_limit is UNLOGGED, and the app role gets INSERT + SELECT only on core_audit_log.
import { sql } from 'drizzle-orm';
import { bigint, bigserial, boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { newId } from './ids/uuid';

const id = () => uuid('id').primaryKey().$defaultFn(newId);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const coreActorType = pgEnum('core_actor_type', ['staff', 'customer', 'system']);
export const coreErrorLevel = pgEnum('core_error_level', ['error', 'warning']);
export const coreIssueStatus = pgEnum('core_issue_status', ['open', 'resolved', 'ignored']);
export const coreIntegrationStatus = pgEnum('core_integration_status', ['ok', 'failed', 'skipped_not_configured']);

export const coreSettings = pgTable(
  'core_settings',
  {
    module: text('module').notNull(),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    isSecret: boolean('is_secret').notNull().default(false),
    keyVersion: integer('key_version'),
    updatedBy: uuid('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.module, t.key] })],
);

export const coreAuditLog = pgTable(
  'core_audit_log',
  {
    id: id(),
    actorId: uuid('actor_id'),
    actorType: coreActorType('actor_type').notNull(),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    ipHash: text('ip_hash'),
    createdAt: createdAt(),
  },
  (t) => [
    index('core_audit_log_entity_idx').on(t.entity, t.entityId),
    index('core_audit_log_actor_idx').on(t.actorId, t.createdAt),
    index('core_audit_log_list_idx').on(t.createdAt.desc(), t.id.desc()),
  ],
);

export const coreRateLimit = pgTable('core_rate_limit', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
});

export const coreErrorIssue = pgTable(
  'core_error_issue',
  {
    id: id(),
    fingerprint: text('fingerprint').notNull().unique(),
    title: text('title').notNull(),
    level: coreErrorLevel('level').notNull().default('error'),
    firstSeen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
    count: integer('count').notNull().default(1),
    status: coreIssueStatus('status').notNull().default('open'),
    release: text('release'),
  },
  (t) => [index('core_error_issue_list_idx').on(t.status, t.lastSeen.desc(), t.id.desc())],
);

export const coreErrorEvent = pgTable(
  'core_error_event',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => coreErrorIssue.id, { onDelete: 'cascade' }),
    message: text('message').notNull(),
    stack: text('stack'),
    route: text('route'),
    method: text('method'),
    url: text('url'),
    requestId: text('request_id'),
    viewerRole: text('viewer_role'),
    release: text('release'),
    createdAt: createdAt(),
  },
  (t) => [index('core_error_event_issue_idx').on(t.issueId, t.createdAt.desc()), index('core_error_event_created_idx').on(t.createdAt)],
);

export const coreIntegrationLog = pgTable(
  'core_integration_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    provider: text('provider').notNull(),
    op: text('op').notNull(),
    status: coreIntegrationStatus('status').notNull(),
    durationMs: integer('duration_ms').notNull(),
    httpStatus: integer('http_status'),
    error: text('error'),
    ref: text('ref'),
    createdAt: createdAt(),
  },
  (t) => [index('core_integration_log_provider_idx').on(t.provider, t.createdAt.desc())],
);

export const coreJobHeartbeat = pgTable('core_job_heartbeat', {
  worker: text('worker').primaryKey(),
  lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
  queues: jsonb('queues').notNull().default(sql`'[]'::jsonb`),
});

export const coreSequence = pgTable('core_sequence', {
  name: text('name').primaryKey(),
  value: bigint('value', { mode: 'number' }).notNull().default(0),
});
