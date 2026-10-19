// Analytics tables (BUILD-PLAN section 3, "analytics"). Every table is prefixed analytics_.
// analytics_event is range-partitioned by month on server_ts. Drizzle cannot declare partitioning, so this file
// declares the parent's columns and indexes and sql/partitions.sql turns it into the partitioned parent (plus the
// current and next two months and a DEFAULT partition). The primary key includes server_ts because every unique
// index on a partitioned table must contain the partition key.
import { bigserial, boolean, date, index, jsonb, numeric, pgEnum, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { newId } from '@ecomkit/core/ids';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const analyticsDevice = pgEnum('analytics_device', ['mobile', 'tablet', 'desktop']);
export const analyticsVitalMetric = pgEnum('analytics_vital_metric', ['LCP', 'INP', 'CLS', 'TTFB']);

/** One browser, identified by the HMAC of the HttpOnly visitor cookie (the cookie value itself is never stored). */
export const analyticsVisitor = pgTable('analytics_visitor', {
  id: uuid('id').primaryKey().$defaultFn(newId),
  cookieHash: text('cookie_hash').notNull().unique(),
  firstSeen: ts('first_seen').notNull().defaultNow(),
  lastSeen: ts('last_seen').notNull().defaultNow(),
  /** Set only while the customer has granted `analytics_identity` consent. */
  customerId: uuid('customer_id'),
  isBot: boolean('is_bot').notNull().default(false),
});

export const analyticsSession = pgTable(
  'analytics_session',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    visitorId: uuid('visitor_id')
      .notNull()
      .references(() => analyticsVisitor.id, { onDelete: 'cascade' }),
    startedAt: ts('started_at').notNull(),
    lastEventAt: ts('last_event_at').notNull(),
    landingPath: text('landing_path').notNull(),
    referrerHost: text('referrer_host'),
    utm: jsonb('utm'),
    device: analyticsDevice('device').notNull(),
    /** direct | search | social | ai | referral | campaign | paid | email (domain `channelOf`). */
    channel: text('channel').notNull().default('direct'),
    isBot: boolean('is_bot').notNull().default(false),
    botName: text('bot_name'),
    /** Staff sessions and sessions that placed a test order: excluded from every report. */
    isTest: boolean('is_test').notNull().default(false),
    country: text('country'),
  },
  (t) => [index('analytics_session_started_idx').on(t.startedAt), index('analytics_session_visitor_idx').on(t.visitorId, t.lastEventAt)],
);

export const analyticsEvent = pgTable(
  'analytics_event',
  {
    id: bigserial('id', { mode: 'number' }).notNull(),
    clientEventId: uuid('client_event_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    visitorId: uuid('visitor_id').notNull(),
    name: text('name').notNull(),
    path: text('path').notNull(),
    props: jsonb('props').notNull().default({}),
    clientTs: ts('client_ts'),
    serverTs: ts('server_ts').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'analytics_event_pkey', columns: [t.id, t.serverTs] }),
    unique('analytics_event_client_event_uq').on(t.clientEventId, t.serverTs),
    index('analytics_event_session_idx').on(t.sessionId, t.serverTs),
    index('analytics_event_name_idx').on(t.name, t.serverTs),
  ],
);

export const analyticsDailyRollup = pgTable(
  'analytics_daily_rollup',
  {
    day: date('day').notNull(),
    metric: text('metric').notNull(),
    /** '' for a total. */
    dimension: text('dimension').notNull().default(''),
    value: numeric('value').notNull(),
  },
  (t) => [primaryKey({ name: 'analytics_daily_rollup_pkey', columns: [t.day, t.metric, t.dimension] })],
);

export const analyticsWebVital = pgTable(
  'analytics_web_vital',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    path: text('path').notNull(),
    metric: analyticsVitalMetric('metric').notNull(),
    value: numeric('value').notNull(),
    device: analyticsDevice('device').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('analytics_web_vital_created_idx').on(t.createdAt, t.metric)],
);
