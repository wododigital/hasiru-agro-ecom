// Marketing tables (BUILD-PLAN section 3, "marketing"). Every table is prefixed marketing_.
// Consent is not stored here: the banner writes customers_consent through the customers API (A28).
// order_id has no foreign key to orders (optional module; each module pushes and runs alone).
import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { newId } from '@ecomkit/core/ids';
import type { Touch } from './domain/attribution';

const id = () => uuid('id').primaryKey().$defaultFn(newId);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const marketingTagVendor = pgEnum('marketing_tag_vendor', ['ga4', 'meta_pixel', 'google_ads', 'custom']);
export const marketingTagPlacement = pgEnum('marketing_tag_placement', ['head', 'body_end']);
export const marketingTagScope = pgEnum('marketing_tag_scope', ['all', 'paths']);
export const marketingDestination = pgEnum('marketing_destination', ['ga4', 'meta']);
export const marketingConversionStatus = pgEnum('marketing_conversion_status', ['pending', 'sent', 'failed', 'skipped_test', 'skipped_consent', 'skipped_not_configured']);

/** Extra tags an admin adds (the built-in GA4, Meta Pixel and Ads tags come from settings). */
export const marketingTag = pgTable('marketing_tag', {
  id: id(),
  name: text('name').notNull(),
  vendor: marketingTagVendor('vendor').notNull().default('custom'),
  placement: marketingTagPlacement('placement').notNull().default('body_end'),
  scope: marketingTagScope('scope').notNull().default('all'),
  /** Path prefixes when scope = paths. */
  paths: text('paths').array().notNull().default(sql`'{}'::text[]`),
  snippet: text('snippet').notNull(),
  /** Hosts the snippet loads from or talks to; merged into the storefront CSP while the tag is active. */
  cspSources: text('csp_sources').array().notNull().default(sql`'{}'::text[]`),
  requiresConsent: boolean('requires_consent').notNull().default(true),
  isActive: boolean('is_active').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * One row per server-side conversion and destination. `event_id` is shared with the browser pixel
 * (`purchase.<orderId>`), so the unique key both dedupes our own retries and lets Meta dedupe pixel + CAPI.
 */
export const marketingConversionEvent = pgTable(
  'marketing_conversion_event',
  {
    id: id(),
    eventId: text('event_id').notNull(),
    name: text('name').notNull(),
    orderId: uuid('order_id'),
    destination: marketingDestination('destination').notNull(),
    status: marketingConversionStatus('status').notNull().default('pending'),
    response: jsonb('response'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('marketing_conversion_event_uq').on(t.destination, t.eventId), index('marketing_conversion_event_list_idx').on(t.createdAt.desc(), t.id.desc())],
);

/** Attribution captured on the order at checkout (first and last touch from first-party cookies, click ids, consent snapshot). */
export const marketingAttribution = pgTable('marketing_attribution', {
  orderId: uuid('order_id').primaryKey(),
  firstTouch: jsonb('first_touch').$type<Touch>(),
  lastTouch: jsonb('last_touch').$type<Touch>(),
  gclid: text('gclid'),
  fbclid: text('fbclid'),
  fbp: text('fbp'),
  fbc: text('fbc'),
  gaClientId: text('ga_client_id'),
  /** The visitor's banner choice when the order was placed; server conversions honour it. */
  consentAnalytics: boolean('consent_analytics').notNull().default(false),
  consentMarketing: boolean('consent_marketing').notNull().default(false),
  userAgent: text('user_agent'),
  createdAt: createdAt(),
});

export type MarketingTagRow = typeof marketingTag.$inferSelect;
export type ConversionEventRow = typeof marketingConversionEvent.$inferSelect;
export type AttributionRow = typeof marketingAttribution.$inferSelect;
