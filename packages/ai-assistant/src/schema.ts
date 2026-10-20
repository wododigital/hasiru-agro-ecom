import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Transcripts and the narration cache. No foreign keys to other modules (customer ids are plain uuids), so the
// module can be enabled or removed on its own.

export const aiConversation = pgTable(
  'ai_conversation',
  {
    id: uuid('id').primaryKey(),
    /** Salted IP hash of the first request (core.hashIp); null in local dev. */
    visitorId: text('visitor_id'),
    customerId: uuid('customer_id'),
    mode: text('mode').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    lastAt: timestamp('last_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_conversation_started_idx').on(t.startedAt), index('ai_conversation_customer_idx').on(t.customerId)],
);

export const aiMessage = pgTable(
  'ai_message',
  {
    id: uuid('id').primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => aiConversation.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant'] }).notNull(),
    content: text('content').notNull(),
    productIds: uuid('product_ids').array().notNull().default(sql`'{}'::uuid[]`),
    /** Assistant rows: intents, notes, the products offered (id + name), validator drops, fallback reason. */
    facts: jsonb('facts').$type<Record<string, unknown>>(),
    /** Model id when a model answered; null for template and cache answers. */
    model: text('model'),
    /** model | cache | template (assistant rows only). */
    source: text('source'),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    latencyMs: integer('latency_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_message_conversation_idx').on(t.conversationId, t.createdAt), index('ai_message_created_idx').on(t.createdAt)],
);

export const aiNarrationCache = pgTable(
  'ai_narration_cache',
  {
    hash: text('hash').primaryKey(),
    model: text('model').notNull(),
    output: jsonb('output').$type<{ answer: string; productIds: string[]; followUps: string[] }>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    hits: integer('hits').notNull().default(0),
  },
  (t) => [index('ai_narration_cache_created_idx').on(t.createdAt)],
);

export type ConversationRow = typeof aiConversation.$inferSelect;
export type MessageRow = typeof aiMessage.$inferSelect;
