// Payment tables (BUILD-PLAN section 3, "payments"). Every table is prefixed payments_.
// order_id is the orders module's id; no FK across modules, so a module can be dropped without touching another's tables.
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { newId } from '@ecomkit/core/ids';

/** The gateway that holds the money. `mock` attempts always talk to the in-app mock, whatever the current mode. */
export const paymentsProvider = pgEnum('payments_provider', ['phonepe', 'mock', 'bank_transfer']);
/** What the buyer chose: pay in full online, an online advance with the balance on delivery, or a bank transfer. */
export const paymentsMethod = pgEnum('payments_method', ['online', 'cod_partial', 'bank_transfer']);
export const paymentsAttemptState = pgEnum('payments_attempt_state', ['pending', 'completed', 'failed', 'expired']);
/** `task`: money to return that nobody has sent back yet (late or mismatched capture); staff start it from admin. */
export const paymentsRefundState = pgEnum('payments_refund_state', ['task', 'pending', 'completed', 'failed']);

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const paymentsAttempt = pgTable(
  'payments_attempt',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    orderId: uuid('order_id').notNull(),
    attemptNo: integer('attempt_no').notNull(),
    provider: paymentsProvider('provider').notNull(),
    method: paymentsMethod('method').notNull(),
    /** `<order number>-<attempt no>`: what the gateway knows the attempt by. Never reused. */
    merchantOrderId: text('merchant_order_id').notNull().unique('payments_attempt_merchant_order_id_uq'),
    providerOrderId: text('provider_order_id'),
    amountPaise: integer('amount_paise').notNull(),
    state: paymentsAttemptState('state').notNull().default('pending'),
    redirectUrl: text('redirect_url'),
    rawCreate: jsonb('raw_create'),
    rawStatus: jsonb('raw_status'),
    /** End of the payment window (shared with the stock reservation, A27). */
    expiresAt: ts('expires_at').notNull(),
    /** Set when the capture was applied to the order (orders.markPaid). A completed attempt without it is an anomaly. */
    appliedAt: ts('applied_at'),
    /** late_completed | amount_mismatch: money captured that the order cannot take. */
    anomaly: text('anomaly'),
    error: text('error'),
    nextPollAt: ts('next_poll_at'),
    pollCount: integer('poll_count').notNull().default(0),
    /** Set once the order's payment window was closed through the orders hook. */
    sweptAt: ts('swept_at'),
    isTest: boolean('is_test').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('payments_attempt_order_no_uq').on(t.orderId, t.attemptNo),
    index('payments_attempt_order_idx').on(t.orderId),
    index('payments_attempt_poll_idx').on(t.nextPollAt).where(sql`${t.state} = 'pending'`),
    index('payments_attempt_sweep_idx').on(t.expiresAt).where(sql`${t.sweptAt} is null`),
    index('payments_attempt_list_idx').on(t.createdAt.desc(), t.id.desc()),
    check('payments_attempt_amount_ck', sql`${t.amountPaise} > 0`),
  ],
);

export const paymentsWebhookEvent = pgTable(
  'payments_webhook_event',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    provider: text('provider').notNull(),
    event: text('event'),
    /** `<event>:<merchant id>:<state>` for verified events; a random value for rejected ones (kept for the alert count). */
    dedupeKey: text('dedupe_key').notNull().unique('payments_webhook_event_dedupe_uq'),
    payload: jsonb('payload'),
    signatureOk: boolean('signature_ok').notNull(),
    processedAt: ts('processed_at'),
    error: text('error'),
    receivedAt: ts('received_at').notNull().defaultNow(),
  },
  (t) => [index('payments_webhook_event_received_idx').on(t.provider, t.signatureOk, t.receivedAt.desc())],
);

export const paymentsRefund = pgTable(
  'payments_refund',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    orderId: uuid('order_id').notNull(),
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => paymentsAttempt.id),
    /** `<merchant order id>-R<n>`. */
    merchantRefundId: text('merchant_refund_id').notNull().unique('payments_refund_merchant_refund_id_uq'),
    providerRefundId: text('provider_refund_id'),
    amountPaise: integer('amount_paise').notNull(),
    state: paymentsRefundState('state').notNull(),
    reason: text('reason'),
    raw: jsonb('raw'),
    actorId: uuid('actor_id'),
    nextPollAt: ts('next_poll_at'),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('payments_refund_order_idx').on(t.orderId),
    index('payments_refund_attempt_idx').on(t.attemptId),
    index('payments_refund_list_idx').on(t.createdAt.desc(), t.id.desc()),
    check('payments_refund_amount_ck', sql`${t.amountPaise} > 0`),
  ],
);

export type PaymentAttemptRow = typeof paymentsAttempt.$inferSelect;
export type PaymentRefundRow = typeof paymentsRefund.$inferSelect;
export type PaymentWebhookEventRow = typeof paymentsWebhookEvent.$inferSelect;
