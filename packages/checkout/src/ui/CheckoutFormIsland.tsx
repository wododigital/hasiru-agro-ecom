'use client';

import type { Paise, ShippingMethodQuote } from '@ecomkit/core/contracts';
import { formatINR } from '@ecomkit/core/money';
import { Button, Checkbox, FormField, Input, Select } from '@ecomkit/ui';
import Link from 'next/link';
import { useActionState, useRef, useState, useTransition, type ReactNode } from 'react';
import { slotLabel as slotText, type PaymentChoice } from '../domain';
import type { CheckoutMessages } from '../messages';
import type { CheckoutPageData, QuoteView } from '../server';
import { marketingConsentAction, placeOrderAction, quoteAction, saveContactAction, type PlaceOrderState } from './actions';

const rs = (p: number) => formatINR(p as Paise);
const ADDRESS_FIELDS = ['line1', 'line2', 'landmark', 'villageTown', 'pincode', 'district', 'districtSlug', 'state', 'stateCode', 'farmPin'] as const;
type AddressField = (typeof ADDRESS_FIELDS)[number];

export interface CheckoutFormIslandProps {
  data: CheckoutPageData;
  idempotencyKey: string;
  messages: CheckoutMessages;
  /** GET endpoint returning `{ found, stateCode, district: { slug, name, stateName } }` for a pincode; null disables autofill. */
  pincodeLookupUrl: string | null;
}

function Section({ step, title, children }: { step: number; title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 sm:p-6" aria-labelledby={`checkout-step-${step}`}>
      <h2 id={`checkout-step-${step}`} className="flex items-center gap-2 text-lg font-semibold">
        <span className="grid size-7 place-items-center rounded-full bg-primary text-sm text-primary-fg">{step}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * The one-page checkout form: contact (autosaved on blur), address (pincode first, autofills district and state),
 * delivery with dates, payment choice per COD mode, summary from the server quote, pay button with the amount.
 * Every total comes from the server (`quoteAction`); place-order reprices again. Errors keep the form filled.
 */
export function CheckoutFormIsland({ data, idempotencyKey, messages: m, pincodeLookupUrl }: CheckoutFormIslandProps) {
  // The key replays an order (and its guest link), so with JS it is a per-browser secret minted on first submit and
  // reused for retries; the server-rendered key only serves the no-JS form.
  const browserKey = useRef<string | null>(null);
  const [view, setView] = useState<QuoteView>(data.quote);
  const [methodId, setMethodId] = useState(view.method?.methodId ?? '');
  const [choice, setChoice] = useState<PaymentChoice>('online');
  const [address, setAddress] = useState<Record<AddressField, string>>(() => Object.fromEntries(ADDRESS_FIELDS.map((k) => [k, data.address?.[k] ?? ''])) as Record<AddressField, string>);
  const [requoting, startRequote] = useTransition();
  const [state, formAction, placing] = useActionState<PlaceOrderState, FormData>(placeOrderAction, null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const formRef = useRef<HTMLFormElement>(null);

  const method = view.methods.find((x) => x.methodId === methodId) ?? view.method;
  const pickup = method?.kind === 'pickup';
  const choices = view.paymentChoices;
  const activeChoice = choices.includes(choice) ? choice : 'online';
  const t = view.totals;
  const payNow = activeChoice === 'partial_advance' ? view.advancePaise : t.totalPaise;
  const fieldErrors = state && !state.ok ? state.fieldErrors : {};
  const formError = state && !state.ok ? (state.formError ? m.errors.invalid : Object.keys(state.fieldErrors).length ? m.errors.invalid : null) : state?.ok && !state.data.ok ? m.errors[state.data.formError] : null;
  const err = (k: string) => (fieldErrors[k]?.length ? m.errors.field : undefined);

  const requote = (patch: { methodId?: string; address?: Partial<Record<AddressField, string>> }) => {
    const a = { ...address, ...patch.address };
    startRequote(async () => {
      const res = await quoteAction({ address: { pincode: a.pincode || null, districtSlug: a.districtSlug || null, stateCode: a.stateCode || null }, methodId: patch.methodId ?? methodId });
      if (res.ok) {
        setView(res.data);
        setMethodId(res.data.method?.methodId ?? '');
      }
    });
  };

  const autosaveContact = () => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const f = formRef.current;
      if (!f) return;
      const v = (k: string) => (f.elements.namedItem(k) as HTMLInputElement | null)?.value ?? '';
      void saveContactAction({ name: v('name'), phone: v('phone'), email: v('email') });
    }, 400);
  };

  const setField = (k: AddressField, v: string) => setAddress((a) => ({ ...a, [k]: v }));

  const onPincode = async (code: string) => {
    setField('pincode', code);
    if (!/^\d{6}$/.test(code)) return;
    let patch: Partial<Record<AddressField, string>> = { pincode: code };
    if (pincodeLookupUrl) {
      try {
        const res = await fetch(`${pincodeLookupUrl}?code=${code}`);
        const body = (await res.json()) as { found?: boolean; stateCode?: string | null; district?: { slug: string; name: string; stateName?: string } | null };
        if (body.found) {
          patch = { ...patch, stateCode: body.stateCode ?? '', district: body.district?.name ?? '', districtSlug: body.district?.slug ?? '', state: body.district?.stateName ?? '' };
          setAddress((a) => ({ ...a, ...patch }));
        }
      } catch {
        // Lookup is a convenience: the buyer can still type district and state.
      }
    }
    requote({ address: patch });
  };

  const methodPrice = (q: ShippingMethodQuote) => (q.pricePaise + q.packingPaise === 0 ? m.delivery.free : rs(q.pricePaise + q.packingPaise));

  return (
    <form
      ref={formRef}
      action={(fd: FormData) => {
        browserKey.current ??= crypto.randomUUID();
        fd.set('idempotencyKey', browserKey.current);
        formAction(fd);
      }}
      className="grid gap-6 lg:grid-cols-[1fr_22rem]" noValidate={false}>
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="expectedTotalPaise" value={t.totalPaise} />
      <input type="hidden" name="districtSlug" value={address.districtSlug} />
      <input type="hidden" name="stateCode" value={address.stateCode} />
      <div className="flex flex-col gap-6">
        {formError ? (
          <p role="alert" className="rounded-md bg-danger/12 px-3 py-2 text-sm text-danger">
            {formError}
          </p>
        ) : null}

        <Section step={1} title={m.contact.title}>
          <FormField id="phone" label={m.contact.phone} help={m.contact.phoneWhy} error={err('phone')}>
            {(p) => <Input {...p} name="phone" type="tel" inputMode="tel" autoComplete="tel" required defaultValue={data.contact.phone ?? ''} onBlur={autosaveContact} />}
          </FormField>
          <FormField id="name" label={m.contact.name} error={err('name')}>
            {(p) => <Input {...p} name="name" autoComplete="name" required maxLength={120} defaultValue={data.contact.name ?? ''} onBlur={autosaveContact} />}
          </FormField>
          <FormField id="email" label={m.contact.email} help={m.contact.emailHelp} error={err('email')}>
            {(p) => <Input {...p} name="email" type="email" autoComplete="email" defaultValue={data.contact.email ?? ''} onBlur={autosaveContact} />}
          </FormField>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox name="marketingConsent" value="1" defaultChecked={data.contact.marketingConsent} onChange={(e) => void marketingConsentAction(e.currentTarget.checked)} data-cta="checkout-marketing-consent" />
            <span>{m.contact.marketingConsent}</span>
          </label>
          {data.signedIn ? null : (
            <p className="text-xs text-muted">
              {m.contact.guestNote}{' '}
              <Link href={m.contact.signInHref} className="text-primary underline" data-cta="checkout-sign-in">
                {m.contact.signIn}
              </Link>
            </p>
          )}
        </Section>

        <Section step={2} title={m.address.title}>
          {pickup ? <p className="text-sm text-muted">{m.address.pickupNote}</p> : null}
          <FormField id="pincode" label={m.address.pincode} help={m.address.pincodeHelp} error={err('address')}>
            {(p) => (
              <Input {...p} name="pincode" inputMode="numeric" autoComplete="postal-code" pattern="\d{6}" maxLength={6} required={!pickup} value={address.pincode} onChange={(e) => void onPincode(e.currentTarget.value.trim())} />
            )}
          </FormField>
          <FormField id="line1" label={m.address.line1}>
            {(p) => <Input {...p} name="line1" autoComplete="address-line1" required={!pickup} maxLength={200} value={address.line1} onChange={(e) => setField('line1', e.currentTarget.value)} />}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="line2" label={m.address.line2}>
              {(p) => <Input {...p} name="line2" autoComplete="address-line2" maxLength={200} value={address.line2} onChange={(e) => setField('line2', e.currentTarget.value)} />}
            </FormField>
            <FormField id="landmark" label={m.address.landmark}>
              {(p) => <Input {...p} name="landmark" maxLength={200} value={address.landmark} onChange={(e) => setField('landmark', e.currentTarget.value)} />}
            </FormField>
            <FormField id="villageTown" label={m.address.villageTown}>
              {(p) => <Input {...p} name="villageTown" autoComplete="address-level3" maxLength={120} value={address.villageTown} onChange={(e) => setField('villageTown', e.currentTarget.value)} />}
            </FormField>
            <FormField id="district" label={m.address.district}>
              {(p) => <Input {...p} name="district" autoComplete="address-level2" maxLength={120} value={address.district} onChange={(e) => setField('district', e.currentTarget.value)} />}
            </FormField>
          </div>
          <FormField id="state" label={m.address.state}>
            {(p) =>
              data.states.length ? (
                <Select
                  {...p}
                  value={address.stateCode}
                  onChange={(e) => {
                    const code = e.currentTarget.value;
                    const name = data.states.find((s) => s.code === code)?.name ?? '';
                    setAddress((a) => ({ ...a, stateCode: code, state: name }));
                    requote({ address: { stateCode: code } });
                  }}
                >
                  <option value="">{m.address.statePick}</option>
                  {data.states.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input {...p} autoComplete="address-level1" maxLength={80} value={address.state} onChange={(e) => setField('state', e.currentTarget.value)} />
              )
            }
          </FormField>
          {data.states.length ? <input type="hidden" name="state" value={address.state} /> : null}
          <FormField id="farmPin" label={m.address.farmPin}>
            {(p) => <Input {...p} name="farmPin" maxLength={200} value={address.farmPin} onChange={(e) => setField('farmPin', e.currentTarget.value)} />}
          </FormField>
          <details className="text-sm">
            <summary className="cursor-pointer text-primary">{m.address.gstin}</summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <FormField id="gstin" label={m.address.gstin} error={err('gstin')}>
                {(p) => <Input {...p} name="gstin" maxLength={15} className="uppercase" />}
              </FormField>
              <FormField id="legalName" label={m.address.legalName} error={err('legalName')}>
                {(p) => <Input {...p} name="legalName" maxLength={200} />}
              </FormField>
            </div>
          </details>
        </Section>

        <Section step={3} title={m.delivery.title}>
          <fieldset className="flex flex-col gap-2" aria-busy={requoting}>
            <legend className="mb-2 text-sm font-medium">{m.delivery.choose}</legend>
            {!address.pincode && !pickup ? <p className="text-sm text-muted">{m.delivery.enterPincode}</p> : null}
            {view.methods.map((q) => (
              <label key={q.methodId} className={`flex items-start gap-3 rounded-md border p-3 ${q.available ? 'border-border' : 'border-border opacity-60'}`}>
                <input
                  type="radio"
                  name="methodId"
                  value={q.methodId}
                  disabled={!q.available}
                  checked={q.methodId === methodId}
                  onChange={() => {
                    setMethodId(q.methodId);
                    requote({ methodId: q.methodId });
                  }}
                  data-cta={`checkout-method-${q.kind}`}
                />
                <span className="flex flex-1 flex-col gap-1">
                  <span className="flex justify-between gap-2 font-medium">
                    {m.delivery.kinds[q.kind]}
                    <span className="tabular-nums">{q.available ? methodPrice(q) : null}</span>
                  </span>
                  {!q.available ? <span className="text-xs text-muted">{m.delivery.unavailable[q.unavailableReason ?? 'default'] ?? m.delivery.unavailable.default}</span> : null}
                  {q.available && q.promise && q.kind !== 'local_slot' ? (
                    <span className="text-xs text-muted">
                      {m.delivery.window} {slotText(q.promise.earliest)} {m.delivery.to} {slotText(q.promise.latest)}
                    </span>
                  ) : null}
                  {q.available && q.vehicle ? (
                    <span className="text-xs text-muted">
                      {m.delivery.vehicle}: {q.vehicle.label}
                    </span>
                  ) : null}
                </span>
              </label>
            ))}
          </fieldset>
          {method?.kind === 'local_slot' && method.slots.length ? (
            <FormField id="slotDate" label={m.delivery.slot}>
              {(p) => (
                <Select {...p} name="slotDate" defaultValue={method.slots.find((s) => s.remaining > 0)?.date}>
                  {method.slots.map((s) => (
                    <option key={s.date} value={s.date} disabled={s.remaining <= 0}>
                      {slotText(s.date)}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          ) : null}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">{m.payment.title}</legend>
            {choices.map((c) => (
              <label key={c} className="flex items-center gap-3 rounded-md border border-border p-3">
                <input type="radio" name="paymentChoice" value={c} checked={c === activeChoice} onChange={() => setChoice(c)} data-cta={`checkout-pay-${c}`} />
                <span className="flex flex-1 justify-between gap-2">
                  {m.payment.choices[c]}
                  {c === 'partial_advance' ? (
                    <span className="text-xs text-muted tabular-nums">
                      {m.payment.advanceNow} {rs(view.advancePaise)} · {m.payment.balanceLater} {rs(t.totalPaise - view.advancePaise)}
                    </span>
                  ) : null}
                </span>
              </label>
            ))}
          </fieldset>
        </Section>
      </div>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
        <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-4" aria-live="polite">
          <h2 className="text-lg font-semibold">{m.summary.title}</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {data.lines.map((l) => {
              const tl = t.lines.find((x) => x.lineId === l.lineId);
              return (
                <li key={l.lineId} className="flex justify-between gap-2">
                  <span>
                    {l.name} × {l.qty}
                  </span>
                  <span className="tabular-nums">{tl ? rs(tl.lineTotalPaise) : null}</span>
                </li>
              );
            })}
          </ul>
          <dl className="flex flex-col gap-1 border-t border-border pt-2 text-sm">
            <Line term={m.summary.subtotal} value={rs(t.subtotalPaise)} />
            {t.tierSavingsPaise > 0 ? <Line term={m.summary.tierSavings} value={`-${rs(t.tierSavingsPaise)}`} /> : null}
            {t.appliedDiscounts.map((d) => (
              <Line key={d.id} term={`${d.kind === 'coupon' ? m.summary.coupon : m.summary.promo}: ${d.label}`} value={`-${rs(d.amountPaise)}`} />
            ))}
            {t.packingPaise > 0 ? <Line term={m.summary.packing} value={rs(t.packingPaise)} /> : null}
            {t.transportPaise > 0 ? <Line term={m.summary.transport} value={rs(t.transportPaise)} /> : null}
            {t.tax.totalTaxPaise > 0 ? <Line term={m.summary.gstIncluded} value={rs(t.tax.totalTaxPaise)} /> : null}
            <div className="flex justify-between gap-2 border-t border-border pt-2 text-base font-semibold">
              <dt>{m.summary.total}</dt>
              <dd className="tabular-nums">{rs(t.totalPaise)}</dd>
            </div>
            <Line term={m.summary.weight} value={`${t.totalWeightKg} ${m.summary.kg}`} />
          </dl>
          {view.couponRejected ? <p className="text-xs text-warning">{m.summary.couponRejected}</p> : null}
          <label className="flex items-start gap-2 text-sm">
            <Checkbox name="policyAck" value="1" required data-cta="checkout-policy-ack" />
            <span>
              {m.policy.ack}{' '}
              <Link href={m.policy.href} className="text-primary underline" target="_blank" data-cta="checkout-policy-link">
                {m.policy.link}
              </Link>
            </span>
          </label>
          {err('policyAck') ? <p className="text-xs text-danger">{m.errors.field}</p> : null}
          <Button type="submit" variant="accent" size="lg" disabled={placing || requoting || !method} data-cta="checkout-pay">
            {placing ? m.placing : activeChoice === 'pay_at_nursery' ? m.payPlace : `${m.pay} ${rs(payNow)}`}
          </Button>
        </section>
      </aside>
    </form>
  );
}

function Line({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt>{term}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
