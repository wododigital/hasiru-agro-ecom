// Checkout tables (BUILD-PLAN section 3, "checkout"). Prefixed checkout_. No foreign keys into cart or orders,
// so the module pushes on its own; the cart id is unique (one open checkout per cart).
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { newId } from '@ecomkit/core/ids';

export const checkoutSession = pgTable(
  'checkout_session',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    cartId: uuid('cart_id').notNull(),
    customerId: uuid('customer_id'),
    /** { name, phone, email, marketingConsent } autosaved on blur so an abandoned checkout has someone to message. */
    contact: jsonb('contact'),
    addressId: uuid('address_id'),
    addressDraft: jsonb('address_draft'),
    methodId: text('method_id'),
    slotDate: text('slot_date'),
    /** Frozen quote: totals breakdown plus the discounts last validated (so a re-quote does not re-try the coupon). */
    quote: jsonb('quote'),
    idempotencyKey: text('idempotency_key'),
    orderId: uuid('order_id'),
    step: text('step').notNull().default('contact'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('checkout_session_cart_key').on(t.cartId),
    uniqueIndex('checkout_session_idempotency_key').on(t.idempotencyKey),
    index('checkout_session_customer_idx').on(t.customerId),
    index('checkout_session_list_idx').on(t.createdAt.desc(), t.id.desc()),
  ],
);
