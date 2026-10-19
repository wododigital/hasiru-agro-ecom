// Customers tables (BUILD-PLAN section 3, "customers"). Every table is prefixed customers_.
// user_id is the auth user id (uuid). No cross-module foreign keys (auth, places), so the module
// can be enabled without them and pushed on its own; ownership is enforced in every query instead.
import { sql } from 'drizzle-orm';
import { boolean, doublePrecision, index, integer, jsonb, numeric, pgEnum, pgTable, pgView, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { newId } from '@ecomkit/core/ids';

const id = () => uuid('id').primaryKey().$defaultFn(newId);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const customersType = pgEnum('customers_type', ['farmer', 'business', 'individual']);
export const customersConsentPurpose = pgEnum('customers_consent_purpose', ['order_updates', 'marketing', 'analytics_identity']);
export const customersConsentStatus = pgEnum('customers_consent_status', ['granted', 'revoked']);
export const customersLeadSource = pgEnum('customers_lead_source', ['wizard', 'notify_me', 'enquiry', 'chat', 'checkout']);
export const customersLeadStatus = pgEnum('customers_lead_status', ['new', 'contacted', 'converted', 'closed']);

export const customersProfile = pgTable(
  'customers_profile',
  {
    userId: uuid('user_id').primaryKey(),
    displayName: text('display_name'),
    phoneE164: text('phone_e164'),
    phoneHash: text('phone_hash'),
    email: text('email'),
    emailHash: text('email_hash'),
    customerType: customersType('customer_type').notNull().default('individual'),
    gstin: text('gstin'),
    legalName: text('legal_name'),
    notes: text('notes'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    firstOrderAt: timestamp('first_order_at', { withTimezone: true }),
    lastOrderAt: timestamp('last_order_at', { withTimezone: true }),
    ordersCount: integer('orders_count').notNull().default(0),
    lifetimePaise: integer('lifetime_paise').notNull().default(0),
    source: text('source'),
    createdAt: createdAt(),
  },
  (t) => [
    index('customers_profile_phone_hash_idx').on(t.phoneHash),
    index('customers_profile_email_hash_idx').on(t.emailHash),
    index('customers_profile_list_idx').on(t.createdAt.desc(), t.userId.desc()),
  ],
);

export const customersAddress = pgTable(
  'customers_address',
  {
    id: id(),
    userId: uuid('user_id').notNull(),
    label: text('label'),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    line1: text('line1').notNull(),
    line2: text('line2'),
    landmark: text('landmark'),
    villageTown: text('village_town'),
    pincode: text('pincode').notNull(),
    /** places_district.id when picked from the typeahead (places is optional, so no FK). */
    districtId: uuid('district_id'),
    districtText: text('district_text').notNull(),
    state: text('state').notNull(),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index('customers_address_user_idx').on(t.userId, t.createdAt.desc(), t.id.desc()),
    index('customers_address_district_idx').on(t.districtId),
    uniqueIndex('customers_address_one_default').on(t.userId).where(sql`is_default`),
  ],
);

/** The only consent store (A28). Append-only: a revocation is a new row; the latest row per subject and purpose wins. */
export const customersConsent = pgTable(
  'customers_consent',
  {
    id: id(),
    userId: uuid('user_id'),
    phoneHash: text('phone_hash'),
    emailHash: text('email_hash'),
    purpose: customersConsentPurpose('purpose').notNull(),
    status: customersConsentStatus('status').notNull(),
    textShown: text('text_shown').notNull(),
    source: text('source').notNull(),
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [
    index('customers_consent_phone_idx').on(t.phoneHash, t.purpose),
    index('customers_consent_email_idx').on(t.emailHash, t.purpose),
    index('customers_consent_user_idx').on(t.userId, t.purpose),
    index('customers_consent_list_idx').on(t.createdAt.desc(), t.id.desc()),
  ],
);

/** The one lead entity: wizard, notify-me, enquiry, chat and checkout all create rows here; only `lead.created` pushes to ops. */
export const customersLead = pgTable(
  'customers_lead',
  {
    id: id(),
    userId: uuid('user_id'),
    name: text('name').notNull(),
    phoneE164: text('phone_e164').notNull(),
    phoneHash: text('phone_hash').notNull(),
    phoneVerified: boolean('phone_verified').notNull().default(false),
    source: customersLeadSource('source').notNull(),
    /** land, district, purpose, planId, enquiryId; `ref` is the dedupe key within a source. */
    context: jsonb('context').$type<Record<string, unknown>>().notNull().default({}),
    status: customersLeadStatus('status').notNull().default('new'),
    assignedTo: uuid('assigned_to'),
    erpPushedAt: timestamp('erp_pushed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('customers_lead_status_idx').on(t.status, t.createdAt.desc(), t.id.desc()),
    index('customers_lead_phone_idx').on(t.phoneHash, t.source),
    index('customers_lead_list_idx').on(t.createdAt.desc(), t.id.desc()),
  ],
);

export const customersLandProfile = pgTable(
  'customers_land_profile',
  {
    id: id(),
    userId: uuid('user_id').notNull(),
    label: text('label').notNull(),
    sqft: numeric('sqft', { mode: 'number' }).notNull(),
    districtId: uuid('district_id'),
    /** Free slug (e.g. a planting model) so the generic module carries no store vocabulary. */
    purpose: text('purpose'),
    planId: uuid('plan_id'),
    createdAt: createdAt(),
  },
  (t) => [index('customers_land_profile_user_idx').on(t.userId, t.createdAt.desc(), t.id.desc())],
);

// Four computed segments (SQL views; no stored definitions).
const segmentColumns = {
  userId: uuid('user_id').notNull(),
  displayName: text('display_name'),
  phoneE164: text('phone_e164'),
  email: text('email'),
  ordersCount: integer('orders_count').notNull(),
  lifetimePaise: integer('lifetime_paise').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
};

/** Exactly one order so far. */
export const customersVSegmentFirstOrder = pgView('customers_v_segment_first_order', segmentColumns).as(
  sql`select user_id, display_name, phone_e164, email, orders_count, lifetime_paise, created_at from customers_profile where orders_count = 1`,
);

/** Bulk buyers: lifetime spend of Rs 25,000 or more, or a customer tagged `bulk`. */
export const customersVSegmentBulkBuyer = pgView('customers_v_segment_bulk_buyer', segmentColumns).as(
  sql`select user_id, display_name, phone_e164, email, orders_count, lifetime_paise, created_at from customers_profile where lifetime_paise >= 2500000 or 'bulk' = any(tags)`,
);

/** Customers per district of their default address (else the newest one). */
export const customersVSegmentByDistrict = pgView('customers_v_segment_by_district', {
  ...segmentColumns,
  districtId: uuid('district_id'),
  districtText: text('district_text').notNull(),
}).as(
  sql`select p.user_id, p.display_name, p.phone_e164, p.email, p.orders_count, p.lifetime_paise, p.created_at, a.district_id, a.district_text
      from customers_profile p
      join lateral (
        select district_id, district_text from customers_address a
        where a.user_id = p.user_id order by a.is_default desc, a.created_at desc, a.id desc limit 1
      ) a on true`,
);

/** Wizard leads whose phone has no customer with an order. */
export const customersVSegmentWizardLeadNoOrder = pgView('customers_v_segment_wizard_lead_no_order', {
  leadId: uuid('lead_id').notNull(),
  name: text('name').notNull(),
  phoneE164: text('phone_e164').notNull(),
  phoneVerified: boolean('phone_verified').notNull(),
  status: text('status').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}).as(
  sql`select l.id as lead_id, l.name, l.phone_e164, l.phone_verified, l.status::text as status, l.created_at
      from customers_lead l
      where l.source = 'wizard' and l.status <> 'converted'
        and not exists (select 1 from customers_profile p where p.phone_hash = l.phone_hash and p.orders_count > 0)`,
);
