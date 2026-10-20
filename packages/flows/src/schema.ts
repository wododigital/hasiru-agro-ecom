// Flows tables (BUILD-PLAN section 3, "flows"). Every table is prefixed flows_.
import { newId } from '@ecomkit/core/ids';
import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const flowsTrigger = pgEnum('flows_trigger', [
  'cart_abandoned',
  'order_placed',
  'order_paid',
  'order_dispatched',
  'order_delivered',
  'slot_reminder',
  'back_in_stock',
  'wizard_lead_no_order',
  'review_request',
]);
export const flowsStatus = pgEnum('flows_status', ['active', 'paused']);
export const flowsStepKind = pgEnum('flows_step_kind', ['send_email', 'send_whatsapp', 'wait', 'stop_if']);
export const flowsRunStatus = pgEnum('flows_run_status', ['running', 'completed', 'stopped', 'failed']);

/** One row per fixed flow. `settings` is the flow's zod-validated form (domain `flowSettingsSchema`). */
export const flowsFlow = pgTable('flows_flow', {
  id: uuid('id').primaryKey().$defaultFn(newId),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  trigger: flowsTrigger('trigger').notNull(),
  status: flowsStatus('status').notNull().default('active'),
  settings: jsonb('settings').notNull(),
  version: integer('version').notNull().default(1),
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Steps are data built from the settings (domain `buildSteps`); positions are stable so running runs keep their place. */
export const flowsStep = pgTable(
  'flows_step',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    flowId: uuid('flow_id')
      .notNull()
      .references(() => flowsFlow.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    kind: flowsStepKind('kind').notNull(),
    config: jsonb('config').notNull(),
  },
  (t) => [uniqueIndex('flows_step_flow_position_uq').on(t.flowId, t.position)],
);

/**
 * One run per (flow, subject). No personal data: the contact is read fresh from the owning module at each step;
 * `contact_hash` (core `hashContact`) is kept for the 7-day cap and for stopping runs on purchase.
 */
export const flowsRun = pgTable(
  'flows_run',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    flowId: uuid('flow_id')
      .notNull()
      .references(() => flowsFlow.id, { onDelete: 'cascade' }),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    contactHash: text('contact_hash'),
    /** Next step position to execute. */
    position: integer('position').notNull().default(0),
    /** Ids and non-personal values the steps need (orderId, stage, slotDate, single-use code). */
    context: jsonb('context').$type<Record<string, string>>().notNull().default({}),
    status: flowsRunStatus('status').notNull().default('running'),
    stopReason: text('stop_reason'),
    nextStepAt: timestamp('next_step_at', { withTimezone: true }),
    messages: integer('messages').notNull().default(0),
    isTest: boolean('is_test').notNull().default(false),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('flows_run_running_subject_uq').on(t.flowId, t.subjectType, t.subjectId).where(sql`${t.status} = 'running'`),
    index('flows_run_due_idx').on(t.status, t.nextStepAt),
    index('flows_run_flow_started_idx').on(t.flowId, t.startedAt),
    index('flows_run_contact_idx').on(t.contactHash, t.startedAt),
  ],
);

export const flowsRunStep = pgTable(
  'flows_run_step',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    runId: uuid('run_id')
      .notNull()
      .references(() => flowsRun.id, { onDelete: 'cascade' }),
    stepId: uuid('step_id').references(() => flowsStep.id, { onDelete: 'set null' }),
    executedAt: timestamp('executed_at', { withTimezone: true }).notNull().defaultNow(),
    result: jsonb('result').notNull(),
  },
  (t) => [index('flows_run_step_run_idx').on(t.runId)],
);
