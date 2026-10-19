// Search tables (BUILD-PLAN section 3, "search"). The trgm expression index over catalog_product is
// hand-written DDL in sql/trgm.sql (Drizzle cannot express it); see README "Migration notes".
import { bigserial, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const searchQueryLog = pgTable(
  'search_query_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** Normalised query; empty for a facet-only zero-result combination. */
    q: text('q').notNull(),
    results: integer('results').notNull(),
    filters: jsonb('filters'),
    sessionId: text('session_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('search_query_log_results_created_idx').on(t.results, t.createdAt)],
);
