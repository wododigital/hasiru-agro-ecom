// Cart tables (BUILD-PLAN section 3, "cart"). Every table is prefixed cart_.
// variant_id is a catalog id and customer_id an auth user id; no FK across modules, so a module can be dropped
// without touching another's tables (a line whose variant is gone renders as unavailable and leaves the totals).
import { newId } from '@ecomkit/core/ids';
import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const cartStatus = pgEnum('cart_status', ['active', 'abandoned', 'converted', 'merged']);
export const cartLineKind = pgEnum('cart_line_kind', ['product', 'package']);

export const cartCart = pgTable(
  'cart_cart',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    /** sha256 of the httpOnly cookie token; the token itself is never stored. */
    cookieTokenHash: text('cookie_token_hash').notNull().unique(),
    customerId: uuid('customer_id'),
    status: cartStatus('status').notNull().default('active'),
    currency: text('currency').notNull().default('INR'),
    couponCode: text('coupon_code'),
    /** `{ methodId }` chosen in the cart; checkout re-quotes it. */
    deliveryMethodSnapshot: jsonb('delivery_method_snapshot').$type<{ methodId: string } | null>(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    abandonedAt: timestamp('abandoned_at', { withTimezone: true }),
    /** Set by checkout (`noteContact`) once a phone or email is saved for this cart. */
    contactAt: timestamp('contact_at', { withTimezone: true }),
    convertedOrderId: uuid('converted_order_id'),
    mergedIntoId: uuid('merged_into_id'),
    landSqft: numeric('land_sqft', { mode: 'number' }),
    /** The package (plan) whose lines are the `package` lines. */
    planId: text('plan_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('cart_cart_customer_idx').on(t.customerId), index('cart_cart_status_activity_idx').on(t.status, t.lastActivityAt)],
);

export const cartLine = pgTable(
  'cart_line',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    cartId: uuid('cart_id')
      .notNull()
      .references(() => cartCart.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id').notNull(),
    qty: integer('qty').notNull(),
    kind: cartLineKind('kind').notNull().default('product'),
    /** CartLineOrigin plus planting extras (role, recommendedQty). */
    origin: jsonb('origin').$type<Record<string, unknown> | null>(),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('cart_line_qty_check', sql`${t.qty} > 0`), uniqueIndex('cart_line_variant_kind_uq').on(t.cartId, t.variantId, t.kind)],
);

export type CartRow = typeof cartCart.$inferSelect;
export type CartLineRow = typeof cartLine.$inferSelect;
