// Inventory tables (BUILD-PLAN section 3, "inventory"). Every table is prefixed inventory_.
// variant_id / product_id are catalog ids; no FK across modules, so a module can be dropped without touching another's tables.
import { sql } from 'drizzle-orm';
import { bigserial, check, index, integer, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const inventorySource = pgEnum('inventory_source', ['manual', 'erp', 'seed']);
export const inventoryReservationStatus = pgEnum('inventory_reservation_status', ['held', 'committed', 'released']);
export const inventoryMovementReason = pgEnum('inventory_movement_reason', ['order', 'cancel', 'adjust', 'erp_sync', 'seed']);

export const inventoryLevel = pgTable(
  'inventory_level',
  {
    variantId: uuid('variant_id').primaryKey(),
    /** Denormalised from catalog so events, the product tab and the PDP section need no cross-module query. */
    productId: uuid('product_id').notNull(),
    /** Snapshot for admin search and ERP mapping display; catalog stays the source of truth. */
    sku: text('sku'),
    onHand: integer('on_hand').notNull().default(0),
    reserved: integer('reserved').notNull().default(0),
    readyInDays: integer('ready_in_days'),
    lowStockThreshold: integer('low_stock_threshold'),
    source: inventorySource('source').notNull().default('seed'),
    /** Last number the ERP reported, kept even while a manual override holds (drift report, clearOverride). */
    erpOnHand: integer('erp_on_hand'),
    erpUpdatedAt: timestamp('erp_updated_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('inventory_level_on_hand_check', sql`${t.onHand} >= 0`),
    check('inventory_level_reserved_check', sql`${t.reserved} >= 0`),
    index('inventory_level_product_idx').on(t.productId),
    index('inventory_level_sku_idx').on(t.sku),
  ],
);

/** One reservation id covers several variants (one row per variant), as the inventory-ops contract returns one id per reserve call. */
export const inventoryReservation = pgTable(
  'inventory_reservation',
  {
    id: uuid('id').notNull(),
    variantId: uuid('variant_id').notNull(),
    qty: integer('qty').notNull(),
    /** Payment attempt, checkout session or order id the hold belongs to. */
    reference: text('reference').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    status: inventoryReservationStatus('status').notNull().default('held'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.variantId] }),
    check('inventory_reservation_qty_check', sql`${t.qty} > 0`),
    index('inventory_reservation_status_expires_idx').on(t.status, t.expiresAt),
    index('inventory_reservation_reference_idx').on(t.reference),
  ],
);

/** Append-only ledger: for every variant, sum(delta) equals inventory_level.on_hand. */
export const inventoryMovement = pgTable(
  'inventory_movement',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    variantId: uuid('variant_id').notNull(),
    delta: integer('delta').notNull(),
    reason: inventoryMovementReason('reason').notNull(),
    ref: text('ref'),
    actorId: uuid('actor_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('inventory_movement_variant_idx').on(t.variantId, t.id.desc())],
);

export const inventorySubscription = pgTable(
  'inventory_subscription',
  {
    id: uuid('id').primaryKey(),
    variantId: uuid('variant_id').notNull(),
    productId: uuid('product_id').notNull(),
    phone: text('phone'),
    email: text('email'),
    /** customers_consent row when the customers module records one (A28); null until then. */
    consentId: uuid('consent_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
  },
  (t) => [
    check('inventory_subscription_contact_check', sql`${t.phone} is not null or ${t.email} is not null`),
    uniqueIndex('inventory_subscription_contact_uq').on(t.variantId, sql`coalesce(${t.phone}, '')`, sql`coalesce(${t.email}, '')`),
    index('inventory_subscription_pending_idx').on(t.variantId).where(sql`${t.notifiedAt} is null`),
  ],
);
