// Notifications tables (BUILD-PLAN section 3, "notifications"). Every table is prefixed notifications_.
import { newId } from '@ecomkit/core/ids';
import { index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uuid, boolean } from 'drizzle-orm/pg-core';

export const notificationsChannel = pgEnum('notifications_channel', ['email', 'whatsapp', 'sms', 'log']);
export const notificationsCategory = pgEnum('notifications_category', ['utility', 'marketing', 'authentication']);
export const notificationsWaTemplateStatus = pgEnum('notifications_wa_template_status', ['draft', 'pending', 'approved', 'rejected', 'paused', 'disabled']);
export const notificationsMessageStatus = pgEnum('notifications_message_status', ['queued', 'sent', 'delivered', 'read', 'failed', 'skipped']);

/** Admin overrides of the default template text (domain/templates.ts). No row = the default is used. */
export const notificationsTemplate = pgTable(
  'notifications_template',
  {
    key: text('key').notNull(),
    channel: notificationsChannel('channel').notNull(),
    locale: text('locale').notNull().default('en'),
    subject: text('subject'),
    body: text('body').notNull(),
    metaTemplateName: text('meta_template_name'),
    category: notificationsCategory('category').notNull(),
    variables: text('variables').array().notNull(),
    version: integer('version').notNull().default(1),
    updatedBy: uuid('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.key, t.channel, t.locale] })],
);

/** Mirror of the templates registered on the WhatsApp Business Account (template sync). */
export const notificationsWhatsappTemplate = pgTable('notifications_whatsapp_template', {
  name: text('name').primaryKey(),
  category: notificationsCategory('category').notNull(),
  language: text('language').notNull(),
  status: notificationsWaTemplateStatus('status').notNull().default('draft'),
  components: jsonb('components').notNull().default([]),
  metaId: text('meta_id'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
});

/** Send log. The recipient is stored hashed and masked only; the address travels in the delivery job. */
export const notificationsMessage = pgTable(
  'notifications_message',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    channel: notificationsChannel('channel').notNull(),
    templateKey: text('template_key').notNull(),
    category: notificationsCategory('category').notNull(),
    toHash: text('to_hash').notNull(),
    toMasked: text('to_masked').notNull(),
    /** Rendered subject, text and WhatsApp params (no recipient), for the message log and the dev outbox. */
    rendered: jsonb('rendered'),
    providerMessageId: text('provider_message_id'),
    status: notificationsMessageStatus('status').notNull().default('queued'),
    errorCode: text('error_code'),
    error: text('error'),
    pricing: jsonb('pricing'),
    orderId: uuid('order_id'),
    flowRunId: uuid('flow_run_id'),
    isTest: boolean('is_test').notNull().default(false),
    queuedAt: timestamp('queued_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notifications_message_status_idx').on(t.status, t.queuedAt),
    index('notifications_message_provider_idx').on(t.providerMessageId),
    index('notifications_message_to_idx').on(t.toHash, t.queuedAt),
  ],
);

/** Raw provider webhooks, stored before processing. One row per status (wamid + status) or inbound message (wamid). */
export const notificationsWebhookEvent = pgTable(
  'notifications_webhook_event',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    provider: text('provider').notNull(),
    dedupeKey: text('dedupe_key').notNull().unique(),
    kind: text('kind').notNull(),
    /** Sender of an inbound message (hashed), for the 24 h service window check. */
    phoneHash: text('phone_hash'),
    payload: jsonb('payload').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [index('notifications_webhook_inbound_idx').on(t.phoneHash, t.receivedAt), index('notifications_webhook_pending_idx').on(t.processedAt)],
);

/** Channel-level suppression (STOP keyword or admin). Blocks marketing messages on that channel. */
export const notificationsOptout = pgTable('notifications_optout', {
  phoneHash: text('phone_hash').primaryKey(),
  channel: notificationsChannel('channel').notNull(),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
