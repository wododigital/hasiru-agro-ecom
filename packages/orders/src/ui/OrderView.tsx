import type { Paise } from '@ecomkit/core/contracts';
import { formatINR } from '@ecomkit/core/money';
import { Badge, buttonVariants, EmptyState, Price } from '@ecomkit/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { istDateTime, slotLabel, type OrderAddress, type OrderDelivery, type OrderStatus, type ProductSnapshot } from '../domain';
import { ordersMessages, type OrdersMessages } from '../messages';
import type { OrderDetail, OrderRow } from '../server';

const rs = (p: number) => formatINR(p as Paise);

const STATUS_TONE: Record<OrderStatus, 'primary' | 'accent' | 'neutral' | 'success' | 'warning' | 'danger' | 'outline'> = {
  pending_payment: 'warning',
  paid: 'primary',
  confirmed: 'primary',
  packed: 'primary',
  dispatched: 'accent',
  delivered: 'success',
  cancelled: 'danger',
  refunded: 'neutral',
  partially_refunded: 'neutral',
};

export function StatusBadge({ status, messages = ordersMessages }: { status: OrderStatus; messages?: OrdersMessages }) {
  return <Badge tone={STATUS_TONE[status]}>{messages.status[status]}</Badge>;
}

function Row({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className={strong ? 'flex justify-between gap-4 border-t border-border pt-2 font-semibold' : 'flex justify-between gap-4 text-sm'}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

export interface OrderViewProps {
  detail: OrderDetail;
  messages?: OrdersMessages;
  /** Invoice download link, shown when an invoice exists. */
  invoiceHref?: string | null;
  /** Shown while the order still awaits payment. */
  payHref?: string | null;
  backHref?: string | null;
  guest?: boolean;
}

/** One order for its buyer: lines, delivery promise, totals (same lines as the cart), invoice link and timeline. */
export function OrderView({ detail, messages = ordersMessages, invoiceHref, payHref, backHref, guest }: OrderViewProps) {
  const m = messages.detail;
  const { order, lines, events, invoice, parent } = detail;
  const delivery = order.delivery as OrderDelivery;
  const address = order.shippingAddress as OrderAddress | null;
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-2">
        {backHref ? (
          <Link href={backHref} className="text-sm text-primary underline-offset-4 hover:underline" data-cta="order-back">
            {m.back}
          </Link>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-3xl text-primary">
            {m.title} {order.number}
          </h1>
          <StatusBadge status={order.status} messages={messages} />
        </div>
        <p className="text-sm text-muted">
          {m.placedOn} {istDateTime(order.placedAt)}
        </p>
        {parent ? (
          <p className="text-sm text-muted">
            {m.replacementOf} {parent.number}
          </p>
        ) : null}
        {guest ? <p className="text-xs text-muted">{m.guestNote}</p> : null}
      </header>

      {payHref && order.status === 'pending_payment' ? (
        <Link href={payHref} className={buttonVariants({ variant: 'accent' })} data-cta="order-pay-now">
          {m.payNow} {rs(order.advancePaise > 0 ? order.advancePaise : order.totalPaise)}
        </Link>
      ) : null}

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{m.items}</h2>
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {lines.map((l) => {
            const p = l.productSnapshot as ProductSnapshot;
            return (
              <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex flex-col">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-xs text-muted">
                    {m.qty} {l.qty} × {rs(l.unitPricePaise)}
                  </span>
                </div>
                <Price paise={l.lineTotalPaise as Paise} size="sm" />
              </li>
            );
          })}
        </ul>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">{m.delivery}</h2>
          {delivery.label ? <p>{delivery.label}</p> : null}
          {delivery.kind === 'pickup' ? <p className="text-sm text-muted">{m.pickup}</p> : null}
          {delivery.slotDate ? (
            <p className="text-sm">
              {m.deliveryDate}: {slotLabel(delivery.slotDate)}
            </p>
          ) : delivery.promise ? (
            <p className="text-sm">
              {m.window} {slotLabel(delivery.promise.earliest)} {m.to} {slotLabel(delivery.promise.latest)}
            </p>
          ) : null}
          {address ? (
            <address className="text-sm not-italic text-muted">
              {[address.name, address.line1, address.line2, address.landmark, address.villageTown, address.district, address.state, address.pincode].filter(Boolean).join(', ')}
            </address>
          ) : null}
        </div>
        <dl className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">{m.summary}</h2>
          <Row label={m.subtotal} value={rs(order.subtotalPaise)} />
          {order.tierSavingsPaise > 0 ? <Row label={m.tierSavings} value={`-${rs(order.tierSavingsPaise)}`} /> : null}
          {order.promoPaise > 0 ? <Row label={m.promo} value={`-${rs(order.promoPaise)}`} /> : null}
          {order.couponPaise > 0 ? <Row label={m.coupon} value={`-${rs(order.couponPaise)}`} /> : null}
          {order.packingPaise > 0 ? <Row label={m.packing} value={rs(order.packingPaise)} /> : null}
          {order.shippingPaise > 0 ? <Row label={m.transport} value={rs(order.shippingPaise)} /> : null}
          {order.taxPaise > 0 ? <Row label={m.gstIncluded} value={rs(order.taxPaise)} /> : null}
          <Row label={m.total} value={rs(order.totalPaise)} strong />
          {order.paidPaise > 0 ? <Row label={m.paid} value={rs(order.paidPaise)} /> : null}
          {order.balanceDuePaise > 0 && order.paidPaise > 0 ? <Row label={m.balance} value={rs(order.balanceDuePaise)} /> : null}
        </dl>
      </div>

      {invoice && invoiceHref ? (
        <a href={invoiceHref} className={buttonVariants({ variant: 'outline' })} data-cta="order-invoice-download">
          {m.invoice} {invoice.number}
        </a>
      ) : null}

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{m.timeline}</h2>
        <ol className="flex flex-col gap-2 border-l-2 border-border pl-4">
          {events
            .filter((e) => e.type !== 'note' && e.type !== 'test_flag' && e.type !== 'refund_requested')
            .map((e) => {
              const d = e.data as { to?: OrderStatus };
              const label = e.type === 'status' && d.to ? messages.status[d.to] : (messages.timeline[e.type as keyof OrdersMessages['timeline']] ?? e.type);
              return (
                <li key={e.id} className="text-sm">
                  <span className="font-medium">{label}</span> <span className="text-muted">{istDateTime(e.createdAt)}</span>
                </li>
              );
            })}
        </ol>
      </div>
    </section>
  );
}

/** The signed-in customer's order list. */
export function OrdersListView({ orders, messages = ordersMessages }: { orders: OrderRow[]; messages?: OrdersMessages }) {
  const m = messages.list;
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-3xl text-primary">{m.title}</h1>
        <p className="text-muted">{m.intro}</p>
      </header>
      {orders.length === 0 ? (
        <EmptyState
          title={m.empty}
          action={
            <Link href={m.emptyHref} className={buttonVariants({})} data-cta="orders-empty-browse">
              {m.emptyAction}
            </Link>
          }
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {orders.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex flex-col">
                <span className="font-medium">{o.number}</span>
                <span className="text-xs text-muted">{istDateTime(o.placedAt)}</span>
              </div>
              <StatusBadge status={o.status} messages={messages} />
              <Price paise={o.totalPaise as Paise} size="sm" />
              <Link href={`/account/orders/${o.id}`} className="text-sm text-primary underline-offset-4 hover:underline" data-cta="orders-view">
                {m.view}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
