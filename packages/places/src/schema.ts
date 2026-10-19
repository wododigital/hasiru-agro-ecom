// Places tables (BUILD-PLAN section 3). Every table is prefixed places_.
import { sql } from 'drizzle-orm';
import { boolean, char, doublePrecision, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { newId } from '@ecomkit/core/ids';

export const placesState = pgTable('places_state', {
  code: char('code', { length: 2 }).primaryKey(),
  name: text('name').notNull(),
  gstCode: char('gst_code', { length: 2 }).notNull(),
});

export const placesDistrict = pgTable(
  'places_district',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    stateCode: char('state_code', { length: 2 })
      .notNull()
      .references(() => placesState.code),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    /** Other spellings people type; matched by the typeahead and by pincode import. */
    aliases: text('aliases').array().notNull().default(sql`'{}'::text[]`),
    hqLat: doublePrecision('hq_lat'),
    hqLng: doublePrecision('hq_lng'),
    distanceKmFromNursery: doublePrecision('distance_km_from_nursery'),
    soilText: text('soil_text').notNull().default(''),
    soilTags: text('soil_tags').array().notNull().default(sql`'{}'::text[]`),
    tempMin: doublePrecision('temp_min').notNull(),
    tempMax: doublePrecision('temp_max').notNull(),
    humidityMin: doublePrecision('humidity_min').notNull(),
    humidityMax: doublePrecision('humidity_max').notNull(),
    rainfallMm: doublePrecision('rainfall_mm').notNull(),
    rivers: text('rivers').array().notNull().default(sql`'{}'::text[]`),
    nativeCrops: text('native_crops').array().notNull().default(sql`'{}'::text[]`),
    taluks: integer('taluks'),
    hoblis: integer('hoblis'),
    villages: integer('villages'),
    pageEnabled: boolean('page_enabled').notNull().default(false),
    /** Short admin-written paragraph shown above the generated facts (sanitised on save). */
    pageIntroHtml: text('page_intro_html'),
    /** `client_sheet` or `derived`; review notes explain anything the seed had to assume. */
    dataSource: text('data_source').notNull().default('client_sheet'),
    reviewNotes: text('review_notes').array().notNull().default(sql`'{}'::text[]`),
    /** Set when staff edit a row: the seed then leaves it alone. */
    adminLocked: boolean('admin_locked').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('places_district_state_idx').on(t.stateCode)],
);

export const placesPincode = pgTable(
  'places_pincode',
  {
    pincode: char('pincode', { length: 6 }).primaryKey(),
    officeName: text('office_name').notNull(),
    /** Null when the India Post district name could not be matched to one of ours. */
    districtId: uuid('district_id').references(() => placesDistrict.id),
    stateCode: char('state_code', { length: 2 })
      .notNull()
      .references(() => placesState.code),
  },
  (t) => [index('places_pincode_district_idx').on(t.districtId)],
);
