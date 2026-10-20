import { getViewer, NotFoundError, requireOwner, requirePermission } from '@ecomkit/core/auth-context';
import type { Viewer } from '@ecomkit/core/contracts';
import { db } from '@ecomkit/core/db';
import { maskPii } from '@ecomkit/customers/domain';
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { istDay, ORDER_STATUSES, type OrderContact, type OrderStatus, type SavedView } from '../domain';
import { ordersEvent, ordersInvoice, ordersLine, ordersOrder } from '../schema';
import { hashGuestToken, type OrderLineRow, type OrderRow } from './orders';

export type OrderEventRow = typeof ordersEvent.$inferSelect;
export type InvoiceSummary = { number: string; kind: 'b2c' | 'b2b'; issuedAt: Date };

export interface OrderDetail {
  order: OrderRow;
  lines: OrderLineRow[];
  events: OrderEventRow[];
  invoice: InvoiceSummary | null;
  parent: { id: string; number: string } | null;
  replacements: { id: string; number: string; status: OrderStatus }[];
}

function maskContact(order: OrderRow, viewer: Viewer): OrderRow {
  const contact = maskPii(order.contact as OrderContact, viewer, order.customerId);
  const address = order.shippingAddress ? maskPii(order.shippingAddress as { phone?: string | null }, viewer, order.customerId) : null;
  return { ...order, contact, shippingAddress: address };
}

/** `viewer` null: the buyer holding the guest token, shown unmasked. */
async function loadDetail(order: OrderRow, viewer: Viewer | null): Promise<OrderDetail> {
  const [lines, events, [invoice], parent, replacements] = await Promise.all([
    db.select().from(ordersLine).where(eq(ordersLine.orderId, order.id)).orderBy(asc(ordersLine.createdAt), asc(ordersLine.id)),
    db.select().from(ordersEvent).where(eq(ordersEvent.orderId, order.id)).orderBy(asc(ordersEvent.createdAt), asc(ordersEvent.id)),
    db.select({ number: ordersInvoice.number, kind: ordersInvoice.kind, issuedAt: ordersInvoice.issuedAt }).from(ordersInvoice).where(eq(ordersInvoice.orderId, order.id)),
    order.parentOrderId ? db.select({ id: ordersOrder.id, number: ordersOrder.number }).from(ordersOrder).where(eq(ordersOrder.id, order.parentOrderId)) : Promise.resolve([]),
    db.select({ id: ordersOrder.id, number: ordersOrder.number, status: ordersOrder.status }).from(ordersOrder).where(eq(ordersOrder.parentOrderId, order.id)).orderBy(asc(ordersOrder.createdAt)),
  ]);
  return { order: viewer ? maskContact(order, viewer) : order, lines, events, invoice: invoice ?? null, parent: parent[0] ?? null, replacements };
}

// ---- customer and guest ---------------------------------------------------------

/** The signed-in customer's orders, newest first. Guests and staff get an empty list (staff use the admin). */
export async function listMyOrders(): Promise<OrderRow[]> {
  const viewer = await getViewer();
  if (viewer.kind !== 'customer') return [];
  return db.select().from(ordersOrder).where(eq(ordersOrder.customerId, viewer.customerId)).orderBy(desc(ordersOrder.placedAt), desc(ordersOrder.id)).limit(200);
}

/** One of the viewer's orders. Anything else (another customer's, a guest order, a bad id) is a NotFoundError. */
export async function getMyOrder(orderId: string): Promise<OrderDetail> {
  const [order] = /^[0-9a-f-]{36}$/i.test(orderId) ? await db.select().from(ordersOrder).where(eq(ordersOrder.id, orderId)) : [];
  if (!order?.customerId) throw new NotFoundError();
  const viewer = await requireOwner(order.customerId);
  return loadDetail(order, viewer);
}

/** Guest confirmation page: the token is the capability (only its hash is stored). */
export async function getOrderByToken(token: string): Promise<OrderDetail | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [order] = await db.select().from(ordersOrder).where(eq(ordersOrder.guestTokenHash, hashGuestToken(token)));
  return order ? loadDetail(order, null) : null;
}

/** Ownership check for pay and invoice routes: the guest token or the signed-in owner. */
export async function orderForBuyer(orderId: string, token: string | null): Promise<OrderRow | null> {
  const [order] = /^[0-9a-f-]{36}$/i.test(orderId) ? await db.select().from(ordersOrder).where(eq(ordersOrder.id, orderId)) : [];
  if (!order) return null;
  if (token && order.guestTokenHash === hashGuestToken(token)) return order;
  const viewer = await getViewer();
  return viewer.kind === 'customer' && order.customerId === viewer.customerId ? order : null;
}

// ---- admin ------------------------------------------------------------------

export interface AdminListParams {
  view: SavedView;
  q?: string | null;
  status?: string | null;
  page?: number;
  pageSize?: number;
  /** Excluded by default from nothing: test orders are listed with a badge. */
  now?: Date;
}

function viewWhere(view: SavedView, today: string): SQL | undefined {
  switch (view) {
    case 'unfulfilled':
      return inArray(ordersOrder.status, ['paid', 'confirmed', 'packed']);
    case 'pending_payment':
      return eq(ordersOrder.status, 'pending_payment');
    case 'todays_slot':
      return and(sql`${ordersOrder.delivery} ->> 'slotDate' = ${today}`, inArray(ordersOrder.status, ['paid', 'confirmed', 'packed', 'dispatched']));
    case 'outstation':
      return sql`${ordersOrder.delivery} ->> 'kind' = 'outstation'`;
    case 'replacements':
      return eq(ordersOrder.source, 'replacement');
    default:
      return undefined;
  }
}

export async function listOrdersAdmin(params: AdminListParams): Promise<{ rows: OrderRow[]; total: number }> {
  const staff = await requirePermission('orders.read');
  const now = params.now ?? new Date();
  const pageSize = Math.min(Math.max(params.pageSize ?? 50, 1), 200);
  const page = Math.max(params.page ?? 1, 1);
  const q = params.q?.trim();
  const status = (ORDER_STATUSES as readonly string[]).includes(params.status ?? '') ? (params.status as OrderStatus) : null;
  const where = and(
    viewWhere(params.view, istDay(now)),
    status ? eq(ordersOrder.status, status) : undefined,
    q ? or(ilike(ordersOrder.number, `%${q}%`), sql`${ordersOrder.contact} ->> 'phone' ilike ${`%${q}%`}`, sql`${ordersOrder.contact} ->> 'name' ilike ${`%${q}%`}`) : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db.select().from(ordersOrder).where(where).orderBy(desc(ordersOrder.placedAt), desc(ordersOrder.id)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ n: count() }).from(ordersOrder).where(where),
  ]);
  return { rows: rows.map((r) => maskContact(r, staff)), total: total!.n };
}

export async function getOrderForStaff(orderId: string): Promise<OrderDetail | null> {
  const staff = await requirePermission('orders.read');
  const [order] = /^[0-9a-f-]{36}$/i.test(orderId) ? await db.select().from(ordersOrder).where(eq(ordersOrder.id, orderId)) : [];
  return order ? loadDetail(order, staff) : null;
}

export interface SlotGroup {
  slotDate: string;
  vehicles: { vehicle: string; orders: { id: string; number: string; status: OrderStatus; weightKg: number; district: string | null }[]; weightKg: number }[];
  weightKg: number;
}

/** Orders to deliver on one slot date (paid, confirmed or packed, not tests last), for the dispatch planner. */
export async function ordersForSlot(slotDate: string): Promise<OrderRow[]> {
  return db
    .select()
    .from(ordersOrder)
    .where(and(sql`${ordersOrder.delivery} ->> 'slotDate' = ${slotDate}`, inArray(ordersOrder.status, ['paid', 'confirmed', 'packed'])))
    .orderBy(asc(ordersOrder.placedAt), asc(ordersOrder.id));
}

/**
 * Dispatch planner: every open order with a slot date from `from` onwards, grouped by slot date and vehicle with
 * weight totals. Orders without a date (outstation, replacements awaiting a slot) come last under "unscheduled".
 */
export async function dispatchPlan(options: { from?: string; now?: Date } = {}): Promise<SlotGroup[]> {
  await requirePermission('orders.dispatch');
  const from = options.from ?? istDay(options.now ?? new Date());
  const rows = await db
    .select()
    .from(ordersOrder)
    .where(
      and(
        inArray(ordersOrder.status, ['paid', 'confirmed', 'packed']),
        or(sql`${ordersOrder.delivery} ->> 'slotDate' >= ${from}`, sql`${ordersOrder.delivery} ->> 'slotDate' is null`),
        sql`${ordersOrder.delivery} ->> 'kind' <> 'pickup'`,
      ),
    )
    .orderBy(asc(ordersOrder.placedAt), asc(ordersOrder.id));
  const groups = new Map<string, SlotGroup>();
  for (const o of rows) {
    const d = o.delivery as { slotDate?: string | null; vehicle?: string | null };
    const slotDate = d.slotDate ?? 'unscheduled';
    const g = groups.get(slotDate) ?? { slotDate, vehicles: [], weightKg: 0 };
    const vehicleName = d.vehicle ?? 'unassigned';
    let v = g.vehicles.find((x) => x.vehicle === vehicleName);
    if (!v) g.vehicles.push((v = { vehicle: vehicleName, orders: [], weightKg: 0 }));
    const weight = Number(o.weightKg);
    v.orders.push({ id: o.id, number: o.number, status: o.status, weightKg: weight, district: (o.shippingAddress as { district?: string | null } | null)?.district ?? null });
    v.weightKg += weight;
    g.weightKg += weight;
    groups.set(slotDate, g);
  }
  return [...groups.values()].sort((a, b) => (a.slotDate === 'unscheduled' ? 1 : b.slotDate === 'unscheduled' ? -1 : a.slotDate.localeCompare(b.slotDate)));
}
