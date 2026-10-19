'use client';

import { Button, Checkbox, FormField, Input } from '@ecomkit/ui';
import { useId, useState, type FormEvent } from 'react';
import type { InventoryMessages } from '../messages';

export interface NotifyMeIslandProps {
  /** Out-of-stock variants of the product; one subscription each. */
  variantIds: readonly string[];
  messages: InventoryMessages['notifyMe'];
  endpoint?: string;
}

type Status = 'idle' | 'sending' | 'done' | 'invalid' | 'rateLimited' | 'failed';

export function NotifyMeIsland({ variantIds, messages: m, endpoint = '/api/notify-me' }: NotifyMeIslandProps) {
  const id = useId();
  const [status, setStatus] = useState<Status>('idle');

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const phone = String(form.get('phone') ?? '').trim();
    const email = String(form.get('email') ?? '').trim();
    if (!phone && !email) return setStatus('invalid');
    setStatus('sending');
    const results = await Promise.all(
      variantIds.map((variantId) =>
        fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ variantId, phone, email, consent: form.get('consent') === 'on', website: form.get('website') ?? '' }),
        }).then((r) => r.status, () => 0),
      ),
    );
    if (results.every((s) => s === 201 || s === 202)) setStatus('done');
    else if (results.includes(429)) setStatus('rateLimited');
    else if (results.includes(400)) setStatus('invalid');
    else setStatus('failed');
  }

  if (status === 'done') {
    return (
      <p role="status" className="rounded-md bg-surface-2 p-4 text-sm text-text">
        {m.done}
      </p>
    );
  }

  const error = status === 'invalid' ? m.invalid : status === 'rateLimited' ? m.rateLimited : status === 'failed' ? m.failed : null;
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4" noValidate>
      <p className="font-semibold text-primary">{m.title}</p>
      <p className="text-sm text-muted">{m.body}</p>
      <FormField id={`${id}-phone`} label={m.phone}>
        {(c) => <Input {...c} name="phone" type="tel" inputMode="tel" autoComplete="tel" />}
      </FormField>
      <FormField id={`${id}-email`} label={m.email}>
        {(c) => <Input {...c} name="email" type="email" autoComplete="email" />}
      </FormField>
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
      <label className="flex items-start gap-2 text-sm text-text">
        <Checkbox name="consent" required />
        <span>{m.consent}</span>
      </label>
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" data-cta="notify-me-submit" disabled={status === 'sending'}>
        {status === 'sending' ? m.sending : m.submit}
      </Button>
    </form>
  );
}
