// Shipping tables (BUILD-PLAN section 3, "shipping"). Every table is prefixed shipping_.
// Districts are referenced by slug (the shipping-method contract speaks slugs) and orders by id, with no FK across
// modules, so places or orders can be switched off without touching these tables.
import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const shippingZoneKind = pgEnum('shipping_zone_kind', ['local', 'outstation', 'enquiry']);
export const shippingMethodKind = pgEnum('shipping_method_kind', ['pickup', 'local_slot', 'outstation_distance']);
export const shippingPackingScope = pgEnum('shipping_packing_scope', ['order', 'product', 'size_class', 'qty_band']);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const shippingZone = pgTable('shipping_zone', {
  id: uuid('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  kind: shippingZoneKind('kind').notNull(),
  districtSlugs: text('district_slugs').array().notNull().default(sql`'{}'::text[]`),
  stateCodes: text('state_codes').array().notNull().default(sql`'{}'::text[]`),
  position: integer('position').notNull().default(0),
  ...timestamps,
});

export const shippingMethod = pgTable(
  'shipping_method',
  {
    id: uuid('id').primaryKey(),
    /** Null = any zone of the matching kind (pickup always). */
    zoneId: uuid('zone_id').references(() => shippingZone.id, { onDelete: 'cascade' }),
    kind: shippingMethodKind('kind').notNull(),
    /** Admin label; storefront copy comes from messages by kind. */
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    rules: jsonb('rules').notNull().default({}),
    position: integer('position').notNull().default(0),
    ...timestamps,
  },
  (t) => [index('shipping_method_zone_idx').on(t.zoneId)],
);

export const shippingVehicle = pgTable(
  'shipping_vehicle',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    capacityKg: integer('capacity_kg').notNull(),
    localFlatPaise: integer('local_flat_paise').notNull(),
    perKmPaise: integer('per_km_paise').notNull(),
    position: integer('position').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    check('shipping_vehicle_capacity_check', sql`${t.capacityKg} > 0`),
    check('shipping_vehicle_rates_check', sql`${t.localFlatPaise} >= 0 and ${t.perKmPaise} >= 0`),
  ],
);

export const shippingSlot = pgTable(
  'shipping_slot',
  {
    id: uuid('id').primaryKey(),
    /** 0 = Sunday .. 6 = Saturday (IST calendar). */
    weekday: integer('weekday').notNull(),
    /** Orders close this many hours before 00:00 IST of the slot day. */
    cutoffHours: integer('cutoff_hours').notNull().default(24),
    capacityKg: integer('capacity_kg'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    check('shipping_slot_weekday_check', sql`${t.weekday} between 0 and 6`),
    check('shipping_slot_cutoff_check', sql`${t.cutoffHours} >= 0`),
  ],
);

/** One active booking per order; capacity is checked under a lock on the slot row. */
export const shippingSlotBooking = pgTable(
  'shipping_slot_booking',
  {
    id: uuid('id').primaryKey(),
    slotId: uuid('slot_id').notNull(),
    slotDate: date('slot_date', { mode: 'string' }).notNull(),
    orderId: uuid('order_id').notNull(),
    orderNumber: text('order_number').notNull(),
    weightKg: numeric('weight_kg', { precision: 10, scale: 3, mode: 'number' }).notNull(),
    remindedAt: timestamp('reminded_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('shipping_slot_booking_order_uq').on(t.orderId), index('shipping_slot_booking_date_idx').on(t.slotDate)],
);

export const shippingPackingRule = pgTable('shipping_packing_rule', {
  id: uuid('id').primaryKey(),
  scope: shippingPackingScope('scope').notNull(),
  match: jsonb('match').notNull().default({}),
  feePaise: integer('fee_paise').notNull(),
  position: integer('position').notNull().default(0),
  ...timestamps,
});

export const shippingDistanceOverride = pgTable('shipping_distance_override', {
  districtSlug: text('district_slug').primaryKey(),
  km: numeric('km', { precision: 8, scale: 1, mode: 'number' }).notNull(),
  note: text('note'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
