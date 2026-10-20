import type { CartBlockProps, Paise, ShippingMethodQuote } from '@ecomkit/core/contracts';
import { formatINR } from '@ecomkit/core/money';
import { Button, buttonVariants, EmptyState, ImageWithFallback, Price, Skeleton, cn } from '@ecomkit/ui';
import Link from 'next/link';
import type { ComponentType } from 'react';
import { formatDeliveryDate } from '../domain';
import type { CartMessages } from '../messages';
import { removeCouponAction, removeLineAction, setDeliveryMethodAction } from '../server/actions';
import type { CartView, CartViewLine } from '../server/view';
import { CouponIsland } from './CouponIsland';
import { LineQtyIsland } from './LineQtyIsland';
import { SubmitOnChangeIsland } from './SubmitOnChangeIsland';

const rs = (p: number) => formatINR(p as Paise);

export function CartSkeleton({ label }: { label: string }) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8" aria-busy="true" aria-label={label}>
      <Skeleton className="h-9 w-48" />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}

function LineRow({ line, m }: { line: CartViewLine; m: CartMessages }) {
  const name = line.name ?? '';
  return (
    <li className="flex gap-3 border-b border-border py-3 last:border-0" data-line={line.lineId}>
      <div className="relative size-20 shrink-0 overflow-hidden rounded-md bg-surface-2">
        <ImageWithFallback image={line.image} alt={line.image?.alt ?? name} fill sizes="80px" className="object-cover" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {line.href ? (
              <Link href={line.href} prefetch={false} className="font-semibold hover:underline">
                {name}
              </Link>
            ) : (
              <span className="font-semibold">{name}</span>
            )}
            {line.nameKn ? (
              <span lang="kn" className="block text-sm text-muted">
                {line.nameKn}
              </span>
            ) : null}
            {line.label ? <span className="block text-sm text-muted">{line.label}</span> : null}
          </div>
          {line.lineTotalPaise !== null ? <Price paise={line.lineTotalPaise} size="sm" /> : null}
        </div>
        {line.available && line.unitPaise !== null ? (
          <p className="text-sm text-muted">
            {rs(line.unitPaise)} {m.line.each}
            {line.bulkReached ? <span className="ml-2 text-success">{m.line.bulkReached}</span> : null}
          </p>
        ) : (
          <p className="text-sm text-danger">{m.line.unavailable}</p>
        )}
        {line.nudge ? (
          <p className="w-fit rounded-sm bg-accent/20 px-2 py-0.5 text-sm" data-nudge={line.lineId}>
            {m.line.bulkAt(line.nudge.minQty, line.nudge.qtyToGo)}
            {' · '}
            {m.line.bulkPrice(rs(line.nudge.unitPaise))}
          </p>
        ) : null}
        {line.origin?.recommendedQty && line.origin.recommendedQty !== line.qty ? <p className="text-xs text-muted">{m.line.recommended(line.origin.recommendedQty)}</p> : null}
        {line.stock ? <p className="text-sm text-warning">{line.stock.note === 'out_of_stock' ? m.line.outOfStock : m.line.short(line.stock.available)}</p> : null}
        <div className="mt-1 flex items-center gap-3">
          {line.available ? <LineQtyIsland lineId={line.lineId} qty={line.qty} itemName={name} /> : null}
          <form action={removeLineAction}>
            <input type="hidden" name="lineId" value={line.lineId} />
            <Button type="submit" variant="link" size="sm" data-cta="cart-remove-line">
              {m.line.remove}
            </Button>
          </form>
        </div>
      </div>
    </li>
  );
}

function methodPromise(q: ShippingMethodQuote, m: CartMessages): string | null {
  if (q.slots[0]) return m.delivery.on(formatDeliveryDate(q.slots[0].date));
  if (!q.promise) return null;
  return q.promise.earliest === q.promise.latest ? m.delivery.on(formatDeliveryDate(q.promise.earliest)) : m.delivery.between(formatDeliveryDate(q.promise.earliest), formatDeliveryDate(q.promise.latest));
}

function DeliveryChooser({ view, m }: { view: CartView; m: CartMessages }) {
  if (!view.methods.length) return null;
  return (
    <section aria-labelledby="cart-delivery" className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
      <h2 id="cart-delivery" className="font-display text-xl text-primary">
        {m.delivery.title}
      </h2>
      <form action={setDeliveryMethodAction} className="flex flex-col gap-2">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm text-muted">{m.delivery.choose}</legend>
          <SubmitOnChangeIsland>
            {view.methods.map((q) => {
              const label = (m.delivery as Record<string, unknown>)[q.kind];
              const when = methodPromise(q, m);
              return (
                <label key={q.methodId} className={cn('flex cursor-pointer items-start gap-3 rounded-md border border-border p-3', !q.available && 'cursor-not-allowed opacity-60')}>
                  <input type="radio" name="methodId" value={q.methodId} defaultChecked={view.selectedMethodId === q.methodId} disabled={!q.available} className="mt-1" data-cta="cart-delivery-method" />
                  <span className="flex flex-1 flex-col">
                    <span className="flex justify-between gap-2 font-medium">
                      <span>{typeof label === 'string' ? label : q.kind}</span>
                      <span>{q.available ? (q.pricePaise > 0 ? rs(q.pricePaise) : m.delivery.free) : null}</span>
                    </span>
                    {q.available ? (
                      <span className="text-sm text-muted">
                        {[when, q.vehicle ? m.delivery.vehicle(q.vehicle.label, q.vehicle.trips) : null].filter(Boolean).join(' · ')}
                      </span>
                    ) : (
                      <span className="text-sm text-muted">{m.delivery.unavailable}</span>
                    )}
                  </span>
                </label>
              );
            })}
          </SubmitOnChangeIsland>
        </fieldset>
        <noscript>
          <Button type="submit" variant="outline" size="sm">
            {m.delivery.save}
          </Button>
        </noscript>
      </form>
    </section>
  );
}

function Summary({ view, m }: { view: CartView; m: CartMessages }) {
  const t = view.totals;
  if (!t) return null;
  const row = (label: string, amount: string, tone?: string, key?: string) => (
    <div key={key ?? label} className={cn('flex justify-between gap-3', tone)}>
      <dt>{label}</dt>
      <dd>{amount}</dd>
    </div>
  );
  const inputsTax = t.tax.byRate.filter((r) => r.ratePct > 0).reduce((s, r) => s + r.taxPaise, 0);
  return (
    <section aria-labelledby="cart-summary" className="flex flex-col gap-3 rounded-lg bg-surface p-4 shadow-card lg:sticky lg:top-24">
      <h2 id="cart-summary" className="font-display text-xl text-primary">
        {m.summary.title}
      </h2>
      <dl className="flex flex-col gap-1.5 text-sm">
        {row(m.summary.subtotal, rs(t.subtotalPaise))}
        {t.tierSavingsPaise > 0 ? row(m.summary.tierSavings, `- ${rs(t.tierSavingsPaise)}`, 'text-success') : null}
        {t.appliedDiscounts.map((d) =>
          d.amountPaise > 0 ? row(d.kind === 'coupon' ? m.summary.coupon(d.label) : m.summary.promo(d.label), `- ${rs(d.amountPaise)}`, 'text-success', d.id) : null,
        )}
        {view.selectedMethodId ? (
          <>
            {t.packingPaise > 0 ? row(m.summary.packing, rs(t.packingPaise)) : null}
            {row(m.summary.transport, t.transportPaise > 0 ? rs(t.transportPaise) : m.delivery.free)}
          </>
        ) : (
          <p className="text-muted">{m.delivery.later}</p>
        )}
        <div className="mt-2 flex justify-between gap-3 border-t border-border pt-2 text-base font-semibold">
          <dt>{m.summary.total}</dt>
          <dd data-total={t.totalPaise}>{rs(t.totalPaise)}</dd>
        </div>
        {inputsTax > 0 ? <p className="text-xs text-muted">{m.summary.gstIncluded(rs(inputsTax))}</p> : null}
      </dl>
      <p className="text-sm text-muted">{m.summary.noReturns}</p>
      <Link href="/checkout" className={buttonVariants({ variant: 'accent', size: 'lg' })} data-cta="cart-proceed-to-pay">
        {m.summary.proceed(rs(t.totalPaise))}
      </Link>
    </section>
  );
}

export interface CartPageProps {
  view: CartView | null;
  messages: CartMessages;
  /** Resolved `cartBlocks` components (placement cart or both), in order. */
  blockComponents: readonly ComponentType<CartBlockProps>[];
  inputsHref: string;
  notice: string | null;
}

/** The cart page body: zones, nudges, inputs suggestion, blocks, delivery chooser, coupon and summary. */
export function CartPageView({ view, messages: m, blockComponents, inputsHref, notice }: CartPageProps) {
  if (!view || !view.lines.length) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="sr-only">{m.page.title}</h1>
        {notice ? <p role="status" className="mb-4 rounded-md bg-surface-2 p-3 text-sm">{notice}</p> : null}
        <EmptyState
          title={m.empty.title}
          body={m.empty.body}
          action={
            <Link href="/plants" className={buttonVariants({})} data-cta="cart-empty-shop">
              {m.empty.shop}
            </Link>
          }
        />
      </div>
    );
  }
  const pkg = view.lines.filter((l) => l.kind === 'package');
  const extra = view.lines.filter((l) => l.kind === 'product');
  const blockProps: CartBlockProps = { cartId: view.cartId, lines: view.blockLines, totals: view.totals, selectedMethodId: view.selectedMethodId };
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
      <div className="flex items-baseline gap-3">
        <h1 className="font-display text-3xl text-primary">{m.page.title}</h1>
        <span className="text-muted">{m.page.items(view.count)}</span>
      </div>
      {notice ? <p role="status" className="rounded-md bg-surface-2 p-3 text-sm">{notice}</p> : null}
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="flex flex-col gap-6">
          {pkg.length ? (
            <section aria-labelledby="cart-package" className="rounded-lg bg-surface-2 p-4" data-zone="package">
              <h2 id="cart-package" className="font-display text-xl text-primary">
                {m.zones.package}
              </h2>
              {view.landSqft ? <p className="text-sm text-muted">{m.zones.packageLand(Math.round(view.landSqft).toLocaleString('en-IN'))}</p> : null}
              <ul>
                {pkg.map((l) => (
                  <LineRow key={l.lineId} line={l} m={m} />
                ))}
              </ul>
            </section>
          ) : null}
          {extra.length ? (
            <section aria-labelledby="cart-additional" className="rounded-lg border border-border bg-surface p-4" data-zone="additional">
              <h2 id="cart-additional" className="font-display text-xl text-primary">
                {m.zones.additional}
              </h2>
              <ul>
                {extra.map((l) => (
                  <LineRow key={l.lineId} line={l} m={m} />
                ))}
              </ul>
            </section>
          ) : null}
          {view.suggestInputs ? (
            <section aria-labelledby="cart-inputs" className="flex flex-col gap-2 rounded-lg border border-dashed border-primary/40 p-4" data-zone="inputs-suggestion">
              <h2 id="cart-inputs" className="font-display text-lg text-primary">
                {m.inputs.title}
              </h2>
              <p className="text-sm text-muted">{m.inputs.body}</p>
              <Link href={inputsHref} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'w-fit')} data-cta="cart-inputs-suggestion">
                {m.inputs.cta}
              </Link>
            </section>
          ) : null}
          {blockComponents.map((Block, i) => (
            <Block key={i} {...blockProps} />
          ))}
          <DeliveryChooser view={view} m={m} />
        </div>
        <div className="flex flex-col gap-4">
          {view.couponsEnabled ? (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
              {view.coupon ? (
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className={view.coupon.applied ? 'text-success' : 'text-warning'}>
                    {view.coupon.applied ? m.coupon.applied(view.coupon.code) : m.coupon.notApplied(view.coupon.code)}
                  </span>
                  <form action={removeCouponAction}>
                    <Button type="submit" variant="link" size="sm" data-cta="cart-remove-coupon">
                      {m.coupon.remove}
                    </Button>
                  </form>
                </div>
              ) : null}
              <CouponIsland labels={{ label: m.coupon.label, placeholder: m.coupon.placeholder, apply: m.coupon.apply, reasons: m.coupon.reasons }} />
            </div>
          ) : null}
          <Summary view={view} m={m} />
        </div>
      </div>
    </div>
  );
}
