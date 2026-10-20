// Pure order logic: status machine with guards, invoice tax maths, saved views, settings and input schemas.
import { z } from 'zod';
import type { Paise, Permission } from '@ecomkit/core/contracts';
import { asPaise, gstSplit, splitGstInclusive } from '@ecomkit/core/money';

export const ORDER_STATUSES = ['pending_payment', 'paid', 'confirmed', 'packed', 'dispatched', 'delivered', 'cancelled', 'refunded', 'partially_refunded'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const PAYMENT_STATUSES = ['unpaid', 'partially_paid', 'paid', 'refunded', 'failed'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const PAYMENT_MODES = ['online', 'partial_advance', 'pay_at_nursery', 'offline', 'none'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];
export const ORDER_SOURCES = ['web', 'manual', 'wizard', 'replacement'] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

// ---- status machine ---------------------------------------------------------

/** Who asks for a transition. System transitions come from payments, the sweep and refunds. */
export type TransitionActor = { type: 'system' } | { type: 'staff'; id: string; permissions: readonly Permission[] };

export interface TransitionSubject {
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paidPaise: number;
  refundedPaise: number;
}

interface Rule {
  /** null: only the system may make this move (payments, sweep, refunds). */
  permission: Permission | null;
  guard?: (o: TransitionSubject) => string | null;
}

const unpaidOnly = (o: TransitionSubject) => (o.paidPaise > 0 ? 'guard.has_payment' : null);
const paymentReceived = (o: TransitionSubject) => (o.paymentStatus === 'paid' || o.paymentStatus === 'partially_paid' ? null : 'guard.no_payment');
const refundTo = (full: boolean) => (o: TransitionSubject) => {
  if (o.paidPaise <= 0 || o.refundedPaise <= 0) return 'guard.no_refund';
  return (o.refundedPaise >= o.paidPaise) === full ? null : full ? 'guard.refund_partial' : 'guard.refund_full';
};
const REFUND_TARGETS: Partial<Record<OrderStatus, Rule>> = {
  refunded: { permission: null, guard: refundTo(true) },
  partially_refunded: { permission: null, guard: refundTo(false) },
};

/**
 * The order status machine. Forward fulfilment moves are staff actions; payment, cancellation of an unpaid
 * order by the sweep, and refunds are system moves recorded by the payment and refund hooks. Policy is
 * "no cancellation, damage replaced": a paid order is never cancelled here, it is refunded (payment anomalies only).
 */
export const TRANSITIONS: Readonly<Record<OrderStatus, Partial<Record<OrderStatus, Rule>>>> = {
  pending_payment: {
    paid: { permission: null, guard: paymentReceived },
    cancelled: { permission: 'orders.write', guard: unpaidOnly },
  },
  paid: { confirmed: { permission: 'orders.write', guard: paymentReceived }, ...REFUND_TARGETS },
  confirmed: { packed: { permission: 'orders.write' }, cancelled: { permission: 'orders.write', guard: unpaidOnly }, ...REFUND_TARGETS },
  packed: { dispatched: { permission: 'orders.dispatch' }, ...REFUND_TARGETS },
  dispatched: { delivered: { permission: 'orders.dispatch' }, ...REFUND_TARGETS },
  delivered: { ...REFUND_TARGETS },
  partially_refunded: { ...REFUND_TARGETS },
  cancelled: {},
  refunded: {},
};

export type TransitionCheck = { ok: true } | { ok: false; reason: 'not_allowed' | 'forbidden' | string };

export function checkTransition(order: TransitionSubject, to: OrderStatus, actor: TransitionActor): TransitionCheck {
  const rule = TRANSITIONS[order.status][to];
  if (!rule) return { ok: false, reason: 'not_allowed' };
  if (actor.type === 'staff' && (rule.permission === null || !actor.permissions.includes(rule.permission))) return { ok: false, reason: 'forbidden' };
  const blocked = rule.guard?.(order) ?? null;
  return blocked ? { ok: false, reason: blocked } : { ok: true };
}

/** Moves a staff member may offer on the detail page (system-only moves are hidden). */
export function staffMoves(order: TransitionSubject, permissions: readonly Permission[]): OrderStatus[] {
  const actor: TransitionActor = { type: 'staff', id: '', permissions };
  return (Object.keys(TRANSITIONS[order.status]) as OrderStatus[]).filter((to) => checkTransition(order, to, actor).ok);
}

/** Catalogue event emitted when an order reaches a status through `transition()`. */
export const STATUS_EVENT = {
  confirmed: 'order.confirmed',
  packed: 'order.packed',
  dispatched: 'order.dispatched',
  delivered: 'order.delivered',
  cancelled: 'order.cancelled',
} as const satisfies Partial<Record<OrderStatus, string>>;

export function paymentStatusFor(totalPaise: number, paidPaise: number, refundedPaise = 0): PaymentStatus {
  if (refundedPaise > 0 && refundedPaise >= paidPaise && paidPaise > 0) return 'refunded';
  if (paidPaise <= 0) return totalPaise === 0 ? 'paid' : 'unpaid';
  return paidPaise >= totalPaise ? 'paid' : 'partially_paid';
}

// ---- GST invoice ------------------------------------------------------------

export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export interface InvoiceLineInput {
  name: string;
  sku: string | null;
  hsn: string | null;
  qty: number;
  gstRatePct: number;
  /** GST-inclusive amount after discounts (orders_line.line_total_paise). */
  lineTotalPaise: number;
}

export interface InvoiceRow {
  hsn: string;
  ratePct: number;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  totalPaise: Paise;
}

export interface InvoiceTax {
  rows: InvoiceRow[];
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  totalPaise: Paise;
}

/**
 * Invoice tax from GST-inclusive amounts (A7): grouped by HSN and rate, tax = amount x r / (100 + r) per group,
 * CGST + SGST halves for an intra-state supply, IGST otherwise. Charges (packing + delivery) are one row under
 * `chargesHsn` at `chargesGstRatePct`. Taxable + tax always adds back to the order total.
 */
export function invoiceTax(input: {
  lines: readonly InvoiceLineInput[];
  chargesPaise: number;
  chargesGstRatePct: number;
  chargesHsn: string;
  interState: boolean;
}): InvoiceTax {
  const groups = new Map<string, { hsn: string; ratePct: number; amount: number }>();
  const add = (hsn: string, ratePct: number, amount: number) => {
    if (amount <= 0) return;
    const key = `${hsn}|${ratePct}`;
    const g = groups.get(key) ?? { hsn, ratePct, amount: 0 };
    g.amount += amount;
    groups.set(key, g);
  };
  for (const l of input.lines) add(l.hsn ?? '', l.gstRatePct, l.lineTotalPaise);
  add(input.chargesHsn, input.chargesGstRatePct, input.chargesPaise);
  const rows = [...groups.values()]
    .sort((a, b) => a.hsn.localeCompare(b.hsn) || a.ratePct - b.ratePct)
    .map((g): InvoiceRow => {
      const { taxablePaise, taxPaise } = splitGstInclusive(asPaise(g.amount), g.ratePct);
      return { hsn: g.hsn, ratePct: g.ratePct, taxablePaise, ...gstSplit(taxPaise, { interState: input.interState }), totalPaise: asPaise(g.amount) };
    });
  const total = (k: keyof Omit<InvoiceRow, 'hsn' | 'ratePct'>) => asPaise(rows.reduce((s, r) => s + r[k], 0));
  return { rows, taxablePaise: total('taxablePaise'), cgstPaise: total('cgstPaise'), sgstPaise: total('sgstPaise'), igstPaise: total('igstPaise'), totalPaise: total('totalPaise') };
}

/** Place of supply for goods is where they are delivered; pickup is a supply at the seller's state. */
export function placeOfSupply(delivery: { kind: string }, address: { stateCode?: string | null } | null, sellerStateCode: string): string | null {
  if (delivery.kind === 'pickup') return sellerStateCode || null;
  return address?.stateCode || null;
}

export function isInterState(pos: string | null, sellerStateCode: string): boolean {
  return !!pos && !!sellerStateCode && pos !== sellerStateCode;
}

// ---- views and lists --------------------------------------------------------

export const SAVED_VIEWS = ['all', 'unfulfilled', 'pending_payment', 'todays_slot', 'outstation', 'replacements'] as const;
export type SavedView = (typeof SAVED_VIEWS)[number];
export const SAVED_VIEW_LABELS: Readonly<Record<SavedView, string>> = {
  all: 'All',
  unfulfilled: 'Unfulfilled',
  pending_payment: 'Pending payment',
  todays_slot: "Today's slot",
  outstation: 'Outstation',
  replacements: 'Replacements',
};

/** YYYY-MM-DD of an instant in Asia/Kolkata. */
export function istDay(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** `20 Oct 2026, 10:00` in IST. */
export function istDateTime(at: Date): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(at);
}

/** `Saturday 24 Oct` for a YYYY-MM-DD date. */
export function slotLabel(day: string): string {
  const parts = new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'short' }).formatToParts(new Date(`${day}T00:00:00Z`));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('weekday')} ${part('day')} ${part('month')}`;
}

// ---- snapshots and inputs ---------------------------------------------------

export const contactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(20).nullable(),
  email: z.email().max(200).nullable(),
});
export type OrderContact = z.infer<typeof contactSchema>;

export const addressSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(20),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).nullish(),
  landmark: z.string().trim().max(200).nullish(),
  villageTown: z.string().trim().max(120).nullish(),
  pincode: z.string().regex(/^\d{6}$/),
  district: z.string().trim().max(120).nullish(),
  districtSlug: z.string().max(120).nullish(),
  state: z.string().trim().max(80).nullish(),
  stateCode: z.string().regex(/^[A-Z]{2}$/).nullish(),
  farmPin: z.string().trim().max(200).nullish(),
});
export type OrderAddress = z.infer<typeof addressSchema>;

export const deliverySchema = z.object({
  methodId: z.string().max(80),
  kind: z.enum(['pickup', 'local_slot', 'outstation', 'enquiry_only', 'manual']),
  label: z.string().max(120).nullish(),
  slotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  vehicle: z.string().max(120).nullish(),
  km: z.number().nullish(),
  promise: z.object({ earliest: z.string(), latest: z.string() }).nullish(),
});
export type OrderDelivery = z.infer<typeof deliverySchema>;

export const billingSchema = z.object({
  gstin: z.string().trim().toUpperCase().regex(GSTIN_RE),
  legalName: z.string().trim().min(1).max(200),
});
export type OrderBilling = z.infer<typeof billingSchema>;

export const productSnapshotSchema = z.object({
  name: z.string().max(200),
  sku: z.string().max(80).nullable(),
  hsn: z.string().max(12).nullable(),
  gstRatePct: z.number().min(0).max(28),
  sizeClass: z.string().max(20).nullable(),
  weightKg: z.number().min(0),
});
export type ProductSnapshot = z.infer<typeof productSnapshotSchema>;

const money = z.number().int().min(0);
export const orderLineInputSchema = z.object({
  variantId: z.uuid(),
  productId: z.uuid(),
  snapshot: productSnapshotSchema,
  qty: z.number().int().positive(),
  listUnitPaise: money,
  unitPaise: money,
  tierApplied: z.boolean().default(false),
  discountPaise: money.default(0),
  taxPaise: money.default(0),
  lineTotalPaise: money,
  kind: z.enum(['product', 'package']).default('product'),
  origin: z.record(z.string(), z.unknown()).nullish(),
});
export type OrderLineInput = z.input<typeof orderLineInputSchema>;

export const orderTotalsSchema = z.object({
  subtotalPaise: money,
  tierSavingsPaise: money,
  promoPaise: money,
  couponPaise: money,
  packingPaise: money,
  shippingPaise: money,
  taxPaise: money,
  totalPaise: money,
  weightKg: z.number().min(0),
  chargesGstRatePct: z.number().min(0).max(28).default(0),
  /** The frozen TotalsBreakdown (applied discounts, tax by rate). */
  breakdown: z.record(z.string(), z.unknown()),
});

export const createOrderSchema = z.object({
  customerId: z.uuid().nullish(),
  contact: contactSchema,
  shippingAddress: addressSchema.nullish(),
  billing: billingSchema.nullish(),
  delivery: deliverySchema,
  lines: z.array(orderLineInputSchema).min(1).max(500),
  totals: orderTotalsSchema,
  source: z.enum(ORDER_SOURCES).default('web'),
  paymentMode: z.enum(PAYMENT_MODES).default('online'),
  /** Online amount asked first; defaults to the total. */
  advancePaise: money.nullish(),
  initialStatus: z.enum(['pending_payment', 'confirmed']).default('pending_payment'),
  reservationId: z.string().max(80).nullish(),
  parentOrderId: z.uuid().nullish(),
  planId: z.uuid().nullish(),
  isTest: z.boolean().default(false),
  attribution: z.record(z.string(), z.unknown()).nullish(),
  notes: z.string().max(2000).nullish(),
});
export type CreateOrderInput = z.input<typeof createOrderSchema>;

export const transitionInputSchema = z.object({ orderId: z.uuid(), to: z.enum(ORDER_STATUSES), note: z.string().trim().max(500).optional() });
export const replacementInputSchema = z.object({
  parentOrderId: z.uuid(),
  lines: z.array(z.object({ lineId: z.uuid(), qty: z.number().int().positive() })).min(1),
  reason: z.string().trim().min(1).max(500),
});
export type ReplacementInput = z.input<typeof replacementInputSchema>;
export const refundInputSchema = z.object({ orderId: z.uuid(), amountPaise: z.number().int().positive(), reason: z.string().trim().min(1).max(500) });
export const noteInputSchema = z.object({ orderId: z.uuid(), note: z.string().trim().min(1).max(2000) });

// ---- settings ---------------------------------------------------------------

export const ordersSettingsSchema = z.object({
  numberPrefix: z
    .string()
    .regex(/^[A-Z0-9]{1,6}$/)
    .default('ORD')
    .meta({ group: 'Numbering', help: 'Order numbers look like PREFIX-YYMM-00001.' }),
  invoicePrefix: z
    .string()
    .regex(/^[A-Z0-9]{1,6}$/)
    .default('INV')
    .meta({ group: 'Numbering', help: 'Invoice numbers look like PREFIX-2026-27-00001, one gapless series per financial year.' }),
  sellerLegalName: z.string().max(200).default('').meta({ group: 'GST invoice', help: 'Legal name printed on invoices.' }),
  sellerGstin: z
    .union([z.literal(''), z.string().regex(GSTIN_RE)])
    .default('')
    .meta({ group: 'GST invoice', placeholder: '29ABCDE1234F1Z5' }),
  sellerAddress: z.string().max(500).default('').meta({ group: 'GST invoice' }),
  sellerStateCode: z
    .union([z.literal(''), z.string().regex(/^[A-Z]{2}$/)])
    .default('')
    .meta({ group: 'GST invoice', help: 'Two-letter state code of the seller (CGST + SGST inside this state, IGST outside).' }),
  chargesHsn: z.string().max(12).default('9965').meta({ group: 'GST invoice', help: 'HSN/SAC printed for packing and delivery charges.' }),
});
export type OrdersSettings = z.infer<typeof ordersSettingsSchema>;

/**
 * Manual order lines typed one per row: `SKU, qty` or `SKU, qty, unit price in rupees`.
 * Blank rows are skipped; a malformed row throws so the form reports it instead of dropping it.
 */
export function parseManualLines(text: string): { sku: string; qty: number; unitPaise: number | null }[] {
  return text
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      const [sku = '', qty = '', price] = row.split(',').map((c) => c.trim());
      const n = Number(qty);
      const rupees = price === undefined || price === '' ? null : Number(price);
      if (!sku || !Number.isInteger(n) || n <= 0 || (rupees !== null && !(rupees >= 0))) throw new RangeError(`bad line: ${row}`);
      return { sku, qty: n, unitPaise: rupees === null ? null : Math.round(rupees * 100) };
    });
}
