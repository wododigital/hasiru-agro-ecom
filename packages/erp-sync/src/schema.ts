// erp-sync tables (BUILD-PLAN section 3, "erp-sync"). Every table is prefixed erp_.
// variant_id / ref_id are other modules' ids; no FK across modules, so a module can be dropped without touching another's tables.
import { newId } from '@ecomkit/core/ids';
import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const erpOutboxKind = pgEnum('erp_outbox_kind', ['order', 'lead']);
export const erpOutboxStatus = pgEnum('erp_outbox_status', ['pending', 'sent', 'failed', 'dead']);
export const erpMappedBy = pgEnum('erp_mapped_by', ['auto', 'manual']);
export const erpRunDirection = pgEnum('erp_run_direction', ['inventory_in', 'orders_out']);

const at = (name: string) => timestamp(name, { withTimezone: true });

/** One row per order or lead to push. Unique on (kind, ref_id): a second event for the same order is a no-op. */
export const erpOutbox = pgTable(
  'erp_outbox',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    kind: erpOutboxKind('kind').notNull(),
    /** Order id or lead id in this store. */
    refId: uuid('ref_id').notNull(),
    /** Snapshot pushed to the ERP (built at first push attempt from fresh state; kept for the CSV bridge and audit). */
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    status: erpOutboxStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    nextAttemptAt: at('next_attempt_at').notNull().defaultNow(),
    sentAt: at('sent_at'),
    /** ERP-side id returned by the push (ops order id); stored here so orders can read it through this module. */
    externalRef: text('external_ref'),
    invoiceNumber: text('invoice_number'),
    createdAt: at('created_at').notNull().defaultNow(),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('erp_outbox_kind_ref_uq').on(t.kind, t.refId),
    index('erp_outbox_status_next_idx').on(t.status, t.nextAttemptAt),
    check('erp_outbox_attempts_check', sql`${t.attempts} >= 0`),
  ],
);

/** Our variant to the ERP item. One to one. */
export const erpItemMap = pgTable(
  'erp_item_map',
  {
    variantId: uuid('variant_id').primaryKey(),
    erpItemId: text('erp_item_id').notNull(),
    erpName: text('erp_name'),
    mappedBy: erpMappedBy('mapped_by').notNull(),
    /** 0..1; 1 for manual and exact SKU matches. */
    confidence: numeric('confidence', { precision: 3, scale: 2, mode: 'number' }).notNull(),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('erp_item_map_erp_item_uq').on(t.erpItemId), check('erp_item_map_confidence_check', sql`${t.confidence} between 0 and 1`)],
);

/**
 * Last-seen snapshot of every ERP item (mapped or not): the unmapped list for the mapping panel and the
 * "ops" side of the drift report. Overwritten on every pull.
 */
export const erpItem = pgTable(
  'erp_item',
  {
    erpItemId: text('erp_item_id').primaryKey(),
    sku: text('sku'),
    name: text('name').notNull(),
    variety: text('variety'),
    available: integer('available').notNull(),
    readyInDays: integer('ready_in_days'),
    costPaise: integer('cost_paise'),
    erpUpdatedAt: at('erp_updated_at'),
    seenAt: at('seen_at').notNull().defaultNow(),
  },
  (t) => [index('erp_item_seen_idx').on(t.seenAt)],
);

/** One row per inventory pull or outbox push run. */
export const erpSyncRun = pgTable(
  'erp_sync_run',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    direction: erpRunDirection('direction').notNull(),
    transport: text('transport').notNull(),
    startedAt: at('started_at').notNull().defaultNow(),
    finishedAt: at('finished_at'),
    items: integer('items').notNull().default(0),
    changed: integer('changed').notNull().default(0),
    errors: integer('errors').notNull().default(0),
    log: jsonb('log').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index('erp_sync_run_direction_started_idx').on(t.direction, t.startedAt.desc())],
);

/** Status callbacks from the ERP: the nonce is the dedupe key (replay protection). */
export const erpWebhookEvent = pgTable('erp_webhook_event', {
  nonce: text('nonce').primaryKey(),
  ecomOrderNumber: text('ecom_order_number').notNull(),
  status: text('status').notNull(),
  /** applied | no_handler | rejected */
  outcome: text('outcome').notNull(),
  receivedAt: at('received_at').notNull().defaultNow(),
});
