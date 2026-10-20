'use client';

import type { ShippingMethodQuote } from '@ecomkit/core/contracts';
import { formatINR } from '@ecomkit/core/money';
import { Button, FormField, Input } from '@ecomkit/ui';
import { useId, useState, type FormEvent } from 'react';
import { formatSlotDate } from '../domain/calendar';
import type { ShippingMessages } from '../messages';

export interface DeliveryCheckIslandProps {
  messages: Pick<ShippingMessages, 'check' | 'methods' | 'reasons'>;
  /** Weight to quote for (the product's unit weight); 1 kg when unknown. */
  weightKg?: number;
  endpoint?: string;
}

type State = { status: 'idle' | 'checking' | 'invalid' | 'unknown' | 'lookupOff' | 'failed' } | { status: 'done'; methods: ShippingMethodQuote[] };

const fill = (template: string, vars: Record<string, string>) => template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');

function promiseLine(q: ShippingMethodQuote, m: DeliveryCheckIslandProps['messages']['check']): string | null {
  if (!q.promise) return null;
  const from = formatSlotDate(q.promise.earliest);
  if (q.kind === 'pickup') return fill(m.readyOn, { date: from });
  if (q.promise.earliest === q.promise.latest) return fill(m.deliveredOn, { date: from });
  return fill(m.deliveredBetween, { from, to: formatSlotDate(q.promise.latest) });
}

/** PDP delivery check: pincode in, every method with its dates and charge out. Works on the delivery-check route. */
export function DeliveryCheckIsland({ messages, weightKg = 1, endpoint = '/api/delivery-check' }: DeliveryCheckIslandProps) {
  const id = useId();
  const m = messages.check;
  const [state, setState] = useState<State>({ status: 'idle' });

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const pincode = String(new FormData(e.currentTarget).get('pincode') ?? '').trim();
    if (!/^[1-9]\d{5}$/.test(pincode)) return setState({ status: 'invalid' });
    setState({ status: 'checking' });
    try {
      const res = await fetch(`${endpoint}?${new URLSearchParams({ pincode, kg: String(weightKg) })}`);
      if (res.status === 404) return setState({ status: 'unknown' });
      if (res.status === 422) return setState({ status: 'lookupOff' });
      if (res.status === 400) return setState({ status: 'invalid' });
      if (!res.ok) return setState({ status: 'failed' });
      const body = (await res.json()) as { methods: ShippingMethodQuote[] };
      setState({ status: 'done', methods: body.methods });
    } catch {
      setState({ status: 'failed' });
    }
  }

  const error = state.status === 'invalid' || state.status === 'unknown' || state.status === 'lookupOff' || state.status === 'failed' ? m[state.status] : null;
  const available = state.status === 'done' ? state.methods.filter((q) => q.available) : [];
  const enquiry = state.status === 'done' ? state.methods.find((q) => q.kind === 'enquiry_only') : undefined;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
      <p className="font-semibold text-primary">{m.title}</p>
      <form onSubmit={onSubmit} className="flex items-end gap-2" noValidate>
        <FormField id={`${id}-pincode`} label={m.pincode} className="flex-1">
          {(c) => <Input {...c} name="pincode" inputMode="numeric" autoComplete="postal-code" maxLength={6} placeholder={m.placeholder} />}
        </FormField>
        <Button type="submit" variant="outline" disabled={state.status === 'checking'} data-cta="pdp-delivery-check">
          {state.status === 'checking' ? m.checking : m.submit}
        </Button>
      </form>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {state.status === 'done' ? (
        <ul role="status" className="flex flex-col gap-2 text-sm">
          {available.map((q) => (
            <li key={q.methodId} className="flex items-start justify-between gap-3">
              <span className="flex flex-col">
                <span className="font-medium text-text">{messages.methods[q.kind]}</span>
                <span className="text-muted">{promiseLine(q, m)}</span>
                {q.distanceKm !== null ? <span className="text-muted">{fill(m.distance, { km: q.distanceKm.toLocaleString('en-IN') })}</span> : null}
              </span>
              <span className="font-medium text-text">{q.pricePaise > 0 ? formatINR(q.pricePaise) : m.free}</span>
            </li>
          ))}
          {enquiry?.unavailableReason ? <li className="text-muted">{messages.reasons[enquiry.unavailableReason]}</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
