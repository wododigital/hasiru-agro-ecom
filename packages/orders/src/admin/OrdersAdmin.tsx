import { can, requirePermission } from '@ecomkit/core/auth-context';
import type { Paise } from '@ecomkit/core/contracts';
import { formatINR } from '@ecomkit/core/money';
import { Badge, Button, buttonVariants, Card, cn, Checkbox, DataTable, DetailFrame, EmptyState, Input, Select, Textarea, type Column } from '@ecomkit/ui';
import { parseTableParams, type SearchParamsInput } from '@ecomkit/ui/domain';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  istDateTime,
  ORDER_STATUSES,
  SAVED_VIEW_LABELS,
  SAVED_VIEWS,
  slotLabel,
  staffMoves,
  type OrderAddress,
  type OrderContact,
  type OrderDelivery,
  type OrderStatus,
  type ProductSnapshot,
  type SavedView,
} from '../domain';
import { ordersMessages } from '../messages';
import { dispatchPlan, getOrderForStaff, getOrdersPorts, listOrdersAdmin, type OrderRow } from '../server';
import { StatusBadge } from '../ui';
import { bulkConfirmAction, bulkPackAction, manualOrderAction, noteAction, offlinePaymentAction, refundAction, replacementAction, testFlagAction, transitionAction } from './actions';

const rs = (p: number) => formatINR(p as Paise);
const STATUS_LABEL = ordersMessages.status;
const PAGE_SIZE = 50;

const ERRORS: Record<string, string> = {
  invalid: 'Some fields are not valid.',
  forbidden: 'Your role cannot do that.',
  not_found: 'Order not found.',
  not_allowed: 'That change is not allowed from the current status.',
  out_of_stock: 'Not enough stock for the replacement lines.',
  payments_unavailable: 'Payments module is not enabled.',
  catalog_unavailable: 'Product lookup is not available.',
  refund_failed: 'The payment provider refused the refund.',
};

function Flash({ flags }: { flags: Record<string, string | undefined> }) {
  if (flags.error) return <p role="alert" className="rounded-md bg-danger/12 px-3 py-2 text-sm text-danger">{ERRORS[flags.error] ?? 'Something went wrong.'}</p>;
  if (flags.done === 'bulk')
    return (
      <p role="status" className="rounded-md bg-success/12 px-3 py-2 text-sm text-success">
        Updated {flags.n ?? 0} orders.{Number(flags.skipped) > 0 ? ` ${flags.skipped} skipped: that change is not allowed from their status.` : ''}
      </p>
    );
  if (flags.done)
    return (
      <p role="status" className="rounded-md bg-success/12 px-3 py-2 text-sm text-success">
        {flags.done === 'replacement' ? 'Replacement order created.' : flags.done === 'created' ? 'Order created.' : 'Saved.'}
        {flags.link ? (
          <>
            {' '}
            Payment link: <code className="break-all">{flags.link}</code>
          </>
        ) : null}
      </p>
    );
  return null;
}

// ---- list -------------------------------------------------------------------

/** /admin/orders (Shopify index): saved-view tabs, search, status filter, row checkboxes with bulk moves, whole-row click. */
export async function OrdersListPage({ searchParams, now: nowOverride }: { searchParams: SearchParamsInput; now?: Date }) {
  const staff = await requirePermission('orders.read');
  const now = nowOverride ?? new Date();
  const params = parseTableParams(searchParams, { filters: { view: SAVED_VIEWS, status: ORDER_STATUSES } });
  const view = (params.filters.view ?? 'all') as SavedView;
  const { rows, total } = await listOrdersAdmin({ view, q: params.q, status: params.filters.status, page: params.page, pageSize: PAGE_SIZE, now });
  const flags = Object.fromEntries(['done', 'n', 'skipped'].map((k) => [k, [(searchParams as Record<string, string | string[] | undefined>)[k]].flat()[0]]));
  const columns: Column<OrderRow>[] = [
    {
      id: 'number',
      header: 'Order',
      cell: (o) => (
        <span className="flex flex-col">
          {o.number}
          <span className="flex gap-1">
            {o.isTest ? <Badge tone="outline">Test</Badge> : null}
            {o.source === 'replacement' ? <Badge tone="neutral">Replacement</Badge> : null}
            {o.source === 'manual' ? <Badge tone="neutral">Manual</Badge> : null}
          </span>
        </span>
      ),
    },
    { id: 'placed', header: 'Placed (IST)', cell: (o) => istDateTime(o.placedAt) },
    { id: 'customer', header: 'Customer', cell: (o) => <span className="flex flex-col">{(o.contact as OrderContact).name}<span className="text-xs text-muted">{(o.contact as OrderContact).phone}</span></span> },
    { id: 'status', header: 'Status', cell: (o) => <StatusBadge status={o.status} /> },
    { id: 'payment', header: 'Payment', cell: (o) => <Badge tone={o.paymentStatus === 'paid' ? 'success' : o.paymentStatus === 'failed' ? 'danger' : 'outline'}>{o.paymentStatus.replace('_', ' ')}</Badge> },
    {
      id: 'delivery',
      header: 'Delivery',
      cell: (o) => {
        const d = o.delivery as OrderDelivery;
        return `${d.label ?? d.kind}${d.slotDate ? `, ${slotLabel(d.slotDate)}` : ''}`;
      },
    },
    { id: 'total', header: 'Total', align: 'right', cell: (o) => rs(o.totalPaise) },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Orders</h1>
        <div className="flex gap-2">
          <Link href="/admin/orders/dispatch" className={buttonVariants({ size: 'sm', variant: 'outline' })} data-cta="orders-dispatch">
            Dispatch planner
          </Link>
          <Link href="/admin/orders/new" className={buttonVariants({ size: 'sm' })} data-cta="orders-new">
            Manual order
          </Link>
        </div>
      </div>
      <Flash flags={flags} />
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(o) => o.id}
        rowHref={(o) => `/admin/orders/${o.id}`}
        params={params}
        total={total}
        pageSize={PAGE_SIZE}
        basePath="/admin/orders"
        views={SAVED_VIEWS.filter((v) => v !== 'all').map((v) => ({ id: v, label: SAVED_VIEW_LABELS[v], filters: { view: v } }))}
        filters={[{ key: 'status', label: 'Status', options: ORDER_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })) }]}
        bulkActions={can(staff, 'orders.write') ? [{ label: 'Confirm', action: bulkConfirmAction }, { label: 'Mark packed', action: bulkPackAction }] : undefined}
        empty={<EmptyState title="No orders in this view" />}
      />
    </div>
  );
}

// ---- detail -----------------------------------------------------------------

const MOVE_LABEL: Partial<Record<OrderStatus, string>> = { confirmed: 'Confirm', packed: 'Mark packed', dispatched: 'Mark dispatched', delivered: 'Mark delivered', cancelled: 'Cancel order' };

/** /admin/orders/[id]: timeline, guarded status moves, refund, replacement, notes, test flag, invoice. */
export async function OrderDetailPage({ id, flags }: { id: string; flags: Record<string, string | undefined> }) {
  const staff = await requirePermission('orders.read');
  const detail = await getOrderForStaff(id);
  if (!detail) notFound();
  const { order: o, lines, events, invoice, parent, replacements } = detail;
  const contact = o.contact as OrderContact;
  const address = o.shippingAddress as OrderAddress | null;
  const delivery = o.delivery as OrderDelivery;
  const moves = staffMoves(o, staff.permissions);
  const refundable = o.paidPaise - o.refundedPaise;
  const canReplace = can(staff, 'orders.write') && (o.status === 'delivered' || o.status === 'partially_refunded');
  const hasPayments = !!getOrdersPorts().payments;
  const [primaryMove, ...otherMoves] = moves.filter((m) => m !== 'cancelled');
  const move = (to: OrderStatus, primary = false) => (
    <form key={to} action={transitionAction}>
      <input type="hidden" name="orderId" value={o.id} />
      <input type="hidden" name="to" value={to} />
      {primary ? (
        <Button type="submit" size="sm" data-cta={`admin-order-${to}`}>
          {MOVE_LABEL[to] ?? to}
        </Button>
      ) : (
        <button type="submit" className={cn('w-full text-left', to === 'cancelled' && 'text-danger')} data-cta={`admin-order-${to}`}>
          {MOVE_LABEL[to] ?? to}
        </button>
      )}
    </form>
  );
  return (
    <DetailFrame
      title={o.number}
      backHref="/admin/orders"
      backLabel="Orders"
      meta={`Placed ${istDateTime(o.placedAt)} (IST)`}
      badges={
        <>
          <StatusBadge status={o.status} />
          <Badge tone="outline">{o.paymentStatus.replace('_', ' ')}</Badge>
          {o.isTest ? <Badge tone="outline">Test</Badge> : null}
          {o.source !== 'web' ? <Badge tone="neutral">{o.source}</Badge> : null}
        </>
      }
      primary={primaryMove ? move(primaryMove, true) : null}
      more={
        <>
          {otherMoves.map((to) => move(to))}
          {invoice ? (
            <a href={`/admin/orders/${o.id}/invoice.pdf`} data-cta="admin-order-invoice">
              Invoice {invoice.number} ({invoice.kind.toUpperCase()})
            </a>
          ) : null}
          {can(staff, 'orders.write') ? (
            <form action={testFlagAction}>
              <input type="hidden" name="orderId" value={o.id} />
              <input type="hidden" name="isTest" value={o.isTest ? '0' : '1'} />
              <button type="submit" className="w-full text-left">
                {o.isTest ? 'Unmark test order' : 'Mark as test order'}
              </button>
            </form>
          ) : null}
          {moves.includes('cancelled') ? move('cancelled') : null}
        </>
      }
      aside={
        <>
        <Card title="Customer">
          <p className="text-sm">
            {contact.name}
            <br />
            {contact.phone}
            <br />
            {contact.email}
          </p>
          {address ? <address className="text-sm not-italic text-muted">{[address.line1, address.line2, address.landmark, address.villageTown, address.district, address.state, address.pincode].filter(Boolean).join(', ')}</address> : null}
        </Card>
        <Card title="Delivery">
          <p className="text-sm">
            {delivery.label ?? delivery.kind}
            {delivery.slotDate ? `, ${slotLabel(delivery.slotDate)}` : ''}
            {delivery.vehicle ? `, ${delivery.vehicle}` : ''}
            {delivery.km ? `, ${delivery.km} km` : ''}
          </p>
          <p className="text-sm text-muted">Weight {Number(o.weightKg)} kg</p>
        </Card>
        {can(staff, 'orders.write') && o.balanceDuePaise > 0 && o.status !== 'cancelled' ? (
          <Card title="Record payment received offline">
            <form action={offlinePaymentAction} className="flex gap-2">
              <input type="hidden" name="orderId" value={o.id} />
              <Input name="amount" type="number" min="1" step="0.01" required defaultValue={o.balanceDuePaise / 100} aria-label="Amount in rupees" />
              <Button type="submit" size="sm">
                Record
              </Button>
            </form>
          </Card>
        ) : null}
        {can(staff, 'orders.refund') && hasPayments && refundable > 0 ? (
          <Card title="Refund (payment anomalies only)">
            <form action={refundAction} className="flex flex-col gap-2">
              <input type="hidden" name="orderId" value={o.id} />
              <Input name="amount" type="number" min="1" step="0.01" max={refundable / 100} required defaultValue={refundable / 100} aria-label="Refund amount in rupees" />
              <Input name="reason" required maxLength={500} placeholder="Reason" aria-label="Reason" />
              <Button type="submit" size="sm" variant="outline" data-cta="admin-order-refund">
                Refund
              </Button>
            </form>
          </Card>
        ) : null}
        {canReplace ? (
          <Card title="Create replacement">
            <form action={replacementAction} className="flex flex-col gap-2">
              <input type="hidden" name="orderId" value={o.id} />
              {lines.map((l) => (
                <label key={l.id} className="flex items-center justify-between gap-2 text-sm">
                  {(l.productSnapshot as ProductSnapshot).name}
                  <Input name={`qty:${l.id}`} type="number" min="0" max={l.qty} defaultValue={0} className="w-20" />
                </label>
              ))}
              <Textarea name="reason" required maxLength={500} placeholder="Damage reported" aria-label="Reason" />
              <Button type="submit" size="sm" data-cta="admin-order-replacement">
                Create zero-value replacement
              </Button>
            </form>
          </Card>
        ) : null}
        </>
      }
    >
      <Flash flags={flags} />
      {parent ? (
        <p className="text-sm">
          Replacement for <Link href={`/admin/orders/${parent.id}`} className="text-primary underline">{parent.number}</Link>
        </p>
      ) : null}
      {replacements.length ? (
        <p className="text-sm">
          Replacements:{' '}
          {replacements.map((r) => (
            <Link key={r.id} href={`/admin/orders/${r.id}`} className="mr-2 text-primary underline">
              {r.number}
            </Link>
          ))}
        </p>
      ) : null}
      <Card title="Items">
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th className="text-right">Unit</th>
              <th className="text-right">Discount</th>
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const p = l.productSnapshot as ProductSnapshot;
              return (
                <tr key={l.id} className="border-t border-border">
                  <td>
                    {p.name} <span className="text-xs text-muted">{p.sku}</span>
                    {l.tierApplied ? <Badge tone="accent" className="ml-1">Bulk</Badge> : null}
                  </td>
                  <td>{l.qty}</td>
                  <td className="text-right">{rs(l.unitPricePaise)}</td>
                  <td className="text-right">{l.lineDiscountPaise ? rs(l.lineDiscountPaise) : ''}</td>
                  <td className="text-right">{rs(l.lineTotalPaise)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <dl className="grid grid-cols-2 gap-x-4 text-sm">
          <dt>Subtotal (list)</dt>
          <dd className="text-right">{rs(o.subtotalPaise)}</dd>
          <dt>Bulk savings</dt>
          <dd className="text-right">-{rs(o.tierSavingsPaise)}</dd>
          <dt>Promotions</dt>
          <dd className="text-right">-{rs(o.promoPaise)}</dd>
          <dt>Coupon</dt>
          <dd className="text-right">-{rs(o.couponPaise)}</dd>
          <dt>Packing</dt>
          <dd className="text-right">{rs(o.packingPaise)}</dd>
          <dt>Delivery</dt>
          <dd className="text-right">{rs(o.shippingPaise)}</dd>
          <dt>GST included</dt>
          <dd className="text-right">{rs(o.taxPaise)}</dd>
          <dt className="font-semibold">Total</dt>
          <dd className="text-right font-semibold">{rs(o.totalPaise)}</dd>
          <dt>Paid</dt>
          <dd className="text-right">{rs(o.paidPaise)}</dd>
          <dt>Refunded</dt>
          <dd className="text-right">{rs(o.refundedPaise)}</dd>
          <dt>Balance due</dt>
          <dd className="text-right">{rs(o.balanceDuePaise)}</dd>
        </dl>
      </Card>
      <Card title="Timeline">
        <ol className="flex flex-col gap-1 text-sm">
          {events.map((e) => (
            <li key={e.id}>
              <span className="text-muted">{istDateTime(e.createdAt)}</span> <b>{e.type}</b> <code className="text-xs">{JSON.stringify(e.data)}</code>
            </li>
          ))}
        </ol>
        {can(staff, 'orders.write') ? (
          <form action={noteAction} className="flex gap-2">
            <input type="hidden" name="orderId" value={o.id} />
            <Input name="note" required maxLength={2000} placeholder="Add a note" aria-label="Note" />
            <Button type="submit" size="sm">
              Add note
            </Button>
          </form>
        ) : null}
      </Card>
    </DetailFrame>
  );
}

// ---- dispatch planner -------------------------------------------------------

/** /admin/orders/dispatch: open orders grouped by slot date and vehicle with weight totals. */
export async function DispatchPage({ now: nowOverride }: { now?: Date } = {}) {
  await requirePermission('orders.dispatch');
  const plan = await dispatchPlan({ now: nowOverride ?? new Date() });
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Dispatch planner</h1>
      {plan.length === 0 ? <EmptyState title="Nothing to dispatch" body="Paid and confirmed delivery orders appear here by slot date." /> : null}
      {plan.map((g) => (
        <Card key={g.slotDate} title={`${g.slotDate === 'unscheduled' ? 'No slot date' : slotLabel(g.slotDate)}: ${g.weightKg} kg`}>
          {g.vehicles.map((v) => (
            <div key={v.vehicle} className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold">
                {v.vehicle} ({v.weightKg} kg, {v.orders.length} orders)
              </h3>
              <ul className="text-sm">
                {v.orders.map((o) => (
                  <li key={o.id}>
                    <Link href={`/admin/orders/${o.id}`} className="text-primary underline">
                      {o.number}
                    </Link>{' '}
                    {STATUS_LABEL[o.status]}, {o.weightKg} kg{o.district ? `, ${o.district}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}

// ---- manual order -----------------------------------------------------------

/** /admin/orders/new: phone or walk-in order; lines by SKU; payment link or offline payment. */
export async function ManualOrderPage({ flags }: { flags: Record<string, string | undefined> }) {
  await requirePermission('orders.write');
  const field = (name: string, label: string, props: Record<string, unknown> = {}) => (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <Input name={name} {...props} />
    </label>
  );
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">Manual order</h1>
      <Flash flags={flags} />
      <form action={manualOrderAction} className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-3">
          {field('name', 'Customer name', { required: true, maxLength: 120 })}
          {field('phone', 'Phone', { type: 'tel', maxLength: 20 })}
          {field('email', 'Email', { type: 'email' })}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {field('line1', 'Address')}
          {field('villageTown', 'Village or town')}
          {field('pincode', 'Pincode', { pattern: '\\d{6}', inputMode: 'numeric' })}
          {field('district', 'District')}
          {field('state', 'State')}
          {field('stateCode', 'State code (e.g. KA)', { maxLength: 2 })}
        </div>
        <label className="flex flex-col gap-1 text-sm">
          Lines (one per row: SKU, qty, optional unit price in Rs)
          <Textarea name="lines" required rows={5} placeholder={'SKU-1, 10\nSKU-2, 50, 320'} />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm">
            Delivery
            <Select name="deliveryKind" defaultValue="pickup">
              <option value="pickup">Pickup</option>
              <option value="local_slot">Local slot</option>
              <option value="outstation">Outstation</option>
              <option value="manual">Other</option>
            </Select>
          </label>
          {field('deliveryLabel', 'Delivery note')}
          {field('slotDate', 'Slot date', { type: 'date' })}
          {field('deliveryFee', 'Delivery fee (Rs)', { type: 'number', min: 0, step: '0.01' })}
          <label className="flex flex-col gap-1 text-sm">
            Payment
            <Select name="paymentMode" defaultValue="online">
              <option value="online">Send payment link</option>
              <option value="offline">Collect offline</option>
            </Select>
          </label>
        </div>
        {field('notes', 'Notes', { maxLength: 2000 })}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox name="isTest" value="1" /> Test order (excluded from reports)
        </label>
        <Button type="submit" data-cta="orders-manual-create">
          Create order
        </Button>
      </form>
    </div>
  );
}
