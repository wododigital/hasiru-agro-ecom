// Orders tables (BUILD-PLAN section 3, "orders"). Every table is prefixed orders_.
// No foreign keys into other modules (customers, catalog, payments, media), so the module can be enabled and
// pushed on its own; ownership is enforced in every query instead.
import { sql } from 'drizzle-orm';
import { bigserial, boolean, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { newId } from '@ecomkit/core/ids';

const id = () => uuid('id').primaryKey().$defaultFn(newId);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const paise = (name: string) => integer(name).notNull().default(0);

export const ordersStatus = pgEnum('orders_status', [
  'pending_payment',
  'paid',
  'confirmed',
  'packed',
  'dispatched',
  'delivered',
  'cancelled',
  'refunded',
  'partially_refunded',
]);
export const ordersPaymentStatus = pgEnum('orders_payment_status', ['unpaid', 'partially_paid', 'paid', 'refunded', 'failed']);
export const ordersSource = pgEnum('orders_source', ['web', 'manual', 'wizard', 'replacement']);
export const ordersPaymentMode = pgEnum('orders_payment_mode', ['online', 'partial_advance', 'pay_at_nursery', 'offline', 'none']);
export const ordersInvoiceKind = pgEnum('orders_invoice_kind', ['b2c', 'b2b']);
export const ordersLineKind = pgEnum('orders_line_kind', ['product', 'package']);

export const ordersOrder = pgTable(
  'orders_order',
  {
    id: id(),
    number: text('number').notNull(),
    customerId: uuid('customer_id'),
    guestTokenHash: text('guest_token_hash'),
    status: ordersStatus('status').notNull(),
    paymentStatus: ordersPaymentStatus('payment_status').notNull().default('unpaid'),
    paymentMode: ordersPaymentMode('payment_mode').notNull().default('online'),
    /** { name, phone, email } */
    contact: jsonb('contact').notNull(),
    shippingAddress: jsonb('shipping_address'),
    /** { gstin, legalName } for a B2B invoice, else null. */
    billing: jsonb('billing'),
    /** { methodId, kind, label, slotDate, vehicle, km, promise } */
    delivery: jsonb('delivery').notNull(),
    subtotalPaise: paise('subtotal_paise'),
    tierSavingsPaise: paise('tier_savings_paise'),
    promoPaise: paise('promo_paise'),
    couponPaise: paise('coupon_paise'),
    packingPaise: paise('packing_paise'),
    shippingPaise: paise('shipping_paise'),
    taxPaise: paise('tax_paise'),
    totalPaise: paise('total_paise'),
    paidPaise: paise('paid_paise'),
    refundedPaise: paise('refunded_paise'),
    balanceDuePaise: paise('balance_due_paise'),
    /** Online amount asked first under partial advance (A14); equals total otherwise. */
    advancePaise: paise('advance_paise'),
    /** Frozen totals breakdown (applied discounts, tax by rate, inter-state flag). */
    totals: jsonb('totals').notNull(),
    weightKg: numeric('weight_kg', { mode: 'number' }).notNull().default(0),
    isTest: boolean('is_test').notNull().default(false),
    source: ordersSource('source').notNull().default('web'),
    parentOrderId: uuid('parent_order_id').references((): AnyPgColumn => ordersOrder.id),
    planId: uuid('plan_id'),
    /** Inventory reservation held for this order (A27); committed on payment, released on cancel. */
    reservationId: text('reservation_id'),
    attribution: jsonb('attribution'),
    notes: text('notes'),
    erpOrderRef: text('erp_order_ref'),
    placedAt: timestamp('placed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('orders_order_number_key').on(t.number),
    uniqueIndex('orders_order_guest_token_key').on(t.guestTokenHash),
    index('orders_order_status_idx').on(t.status, t.placedAt.desc()),
    index('orders_order_customer_idx').on(t.customerId, t.placedAt.desc()),
    index('orders_order_payment_status_idx').on(t.paymentStatus),
    index('orders_order_is_test_idx').on(t.isTest),
    index('orders_order_parent_idx').on(t.parentOrderId),
    index('orders_order_list_idx').on(t.createdAt.desc(), t.id.desc()),
    index('orders_order_slot_idx').on(sql`((delivery ->> 'slotDate'))`),
  ],
);

export const ordersLine = pgTable(
  'orders_line',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => ordersOrder.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id').notNull(),
    productId: uuid('product_id').notNull(),
    /** { name, sku, hsn, gstRatePct, sizeClass, weightKg } at the time of the order. */
    productSnapshot: jsonb('product_snapshot').notNull(),
    qty: integer('qty').notNull(),
    listUnitPaise: paise('list_unit_paise'),
    unitPricePaise: paise('unit_price_paise'),
    tierApplied: boolean('tier_applied').notNull().default(false),
    lineDiscountPaise: paise('line_discount_paise'),
    lineTaxPaise: paise('line_tax_paise'),
    lineTotalPaise: paise('line_total_paise'),
    kind: ordersLineKind('kind').notNull().default('product'),
    origin: jsonb('origin'),
    createdAt: createdAt(),
  },
  (t) => [index('orders_line_order_idx').on(t.orderId), index('orders_line_variant_idx').on(t.variantId)],
);

/** The timeline: every status change, payment, refund, note, replacement link. Append-only. */
export const ordersEvent = pgTable(
  'orders_event',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => ordersOrder.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    data: jsonb('data').notNull().default({}),
    actorId: uuid('actor_id'),
    createdAt: createdAt(),
  },
  (t) => [index('orders_event_order_idx').on(t.orderId, t.createdAt, t.id)],
);

export const ordersInvoice = pgTable(
  'orders_invoice',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => ordersOrder.id),
    /** INV-YYYY-YY-NNNNN, gapless per financial year (core_sequence). */
    number: text('number').notNull(),
    kind: ordersInvoiceKind('kind').notNull(),
    placeOfSupply: text('place_of_supply'),
    isInterState: boolean('is_inter_state').notNull(),
    taxablePaise: paise('taxable_paise'),
    cgstPaise: paise('cgst_paise'),
    sgstPaise: paise('sgst_paise'),
    igstPaise: paise('igst_paise'),
    totalPaise: paise('total_paise'),
    /** Frozen invoice document (seller, buyer, rows by HSN, lines); the PDF renders from this alone. */
    document: jsonb('document').notNull(),
    pdfMediaId: uuid('pdf_media_id'),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('orders_invoice_number_key').on(t.number), uniqueIndex('orders_invoice_order_key').on(t.orderId)],
);

export const ordersFulfilment = pgTable(
  'orders_fulfilment',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => ordersOrder.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    vehicle: text('vehicle'),
    driverNote: text('driver_note'),
    trackingText: text('tracking_text'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('orders_fulfilment_order_key').on(t.orderId)],
);
