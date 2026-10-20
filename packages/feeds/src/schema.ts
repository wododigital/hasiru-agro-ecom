// Feeds tables (BUILD-PLAN section 3, "feeds"). Every table is prefixed feeds_. variant_id has no foreign key
// to catalog (each module pushes and runs alone).
import { index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { newId } from '@ecomkit/core/ids';

export const feedsDestination = pgEnum('feeds_destination', ['google', 'meta']);
export const feedsRunKind = pgEnum('feeds_run_kind', ['full', 'delta']);

/** Per destination and variant: the hash of the item last written to the feed file, or the validation error that kept it out. */
export const feedsItemState = pgTable(
  'feeds_item_state',
  {
    destination: feedsDestination('destination').notNull(),
    variantId: uuid('variant_id').notNull(),
    hash: text('hash'),
    lastPushedAt: timestamp('last_pushed_at', { withTimezone: true }),
    lastError: text('last_error'),
  },
  (t) => [primaryKey({ columns: [t.destination, t.variantId] })],
);

export interface FeedRunLog {
  changed: number;
  added: number;
  removed: number;
  unchanged: number;
  rewritten: boolean;
  issues: { itemId: string; variantId: string; field: string; message: string; severity: 'error' | 'warning' }[];
}

export const feedsRun = pgTable(
  'feeds_run',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    destination: feedsDestination('destination').notNull(),
    kind: feedsRunKind('kind').notNull(),
    items: integer('items').notNull().default(0),
    errors: integer('errors').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    log: jsonb('log').$type<FeedRunLog>(),
  },
  (t) => [index('feeds_run_list_idx').on(t.destination, t.startedAt.desc())],
);

/** The current file per destination, served by /feeds/google.xml and /feeds/meta.csv (web and worker share it). */
export const feedsFile = pgTable('feeds_file', {
  destination: feedsDestination('destination').primaryKey(),
  body: text('body').notNull(),
  contentType: text('content_type').notNull(),
  etag: text('etag').notNull(),
  items: integer('items').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull(),
});

export type FeedItemStateRow = typeof feedsItemState.$inferSelect;
export type FeedRunRow = typeof feedsRun.$inferSelect;
export type FeedFileRow = typeof feedsFile.$inferSelect;
