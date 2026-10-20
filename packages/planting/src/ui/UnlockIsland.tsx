'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { Button, Input } from '@ecomkit/ui';
import type { PlantingMessages } from '../messages';

type Status = 'unlocked' | 'sent' | 'invalid' | 'code_invalid' | 'limited' | 'not_found' | 'wrong_mode' | 'not_configured';

/**
 * The unlock card over the blurred preview. `soft`: name + phone unlock straight away. `otp`: send a code, then verify
 * (6 digits). Without JavaScript the form posts to the same endpoint and the page reloads unlocked.
 */
export function UnlockIsland({
  planId,
  mode,
  modelName,
  initialError,
  messages,
  endpoint = '/api/plan/unlock',
}: {
  planId: string;
  mode: 'soft' | 'otp';
  modelName: string;
  initialError: string | null;
  messages: PlantingMessages['unlock'];
  endpoint?: string;
}) {
  const m = messages;
  const ids = useId();
  const router = useRouter();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  const errorFor = (s: Status) => (s === 'code_invalid' ? m.codeInvalid : s === 'limited' ? m.limited : s === 'invalid' ? m.invalid : m.failed);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const step = mode === 'soft' ? 'soft' : sent ? 'verify' : 'send';
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ step, planId, name, phone, ...(step === 'verify' ? { code } : {}) }) });
      const { status } = (await res.json()) as { status: Status };
      if (status === 'unlocked') router.refresh();
      else if (status === 'sent') setSent(true);
      else setError(errorFor(status));
    } catch {
      setError(m.failed);
    } finally {
      setBusy(false);
    }
  }

  const step = mode === 'soft' ? 'soft' : sent ? 'verify' : 'send';
  return (
    <form method="post" action={endpoint} onSubmit={submit} className="w-full max-w-md space-y-4 rounded-lg border border-border bg-surface p-6 shadow-card" aria-labelledby={`${ids}-h`}>
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="step" value={step} />
      <p className="text-sm font-semibold tracking-wide text-accent uppercase">{m.ready}</p>
      <h2 id={`${ids}-h`} className="font-display text-2xl text-primary">
        {m.title} · {modelName}
      </h2>
      <p className="text-sm text-muted">
        {m.text} {mode === 'otp' ? m.otpText : null}
      </p>
      {sent ? (
        <div className="space-y-1">
          <label htmlFor={`${ids}-code`} className="text-sm font-semibold">
            {m.code}
          </label>
          <Input id={`${ids}-code`} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          <p className="text-xs text-muted">
            {m.sentTo} {m.phonePrefix} {phone}{' '}
            <button type="button" className="font-semibold text-primary underline" onClick={() => (setSent(false), setCode(''))}>
              {m.change}
            </button>
          </p>
          <input type="hidden" name="name" value={name} />
          <input type="hidden" name="phone" value={phone} />
        </div>
      ) : (
        <>
          <div className="space-y-1">
            <label htmlFor={`${ids}-name`} className="text-sm font-semibold">
              {m.name}
            </label>
            <Input id={`${ids}-name`} name="name" autoComplete="name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label htmlFor={`${ids}-phone`} className="text-sm font-semibold">
              {m.phone}
            </label>
            <div className="flex items-center gap-2">
              <span className="rounded-sm bg-surface-2 px-3 py-2.5 text-sm font-semibold">{m.phonePrefix}</span>
              <Input id={`${ids}-phone`} name="phone" type="tel" inputMode="numeric" autoComplete="tel-national" required maxLength={14} value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d ]/g, ''))} />
            </div>
          </div>
        </>
      )}
      {error ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="accent" className="w-full" disabled={busy} data-cta="plan-unlock">
        {busy ? m.working : step === 'soft' ? m.submitSoft : step === 'send' ? m.send : m.verify}
      </Button>
      <p className="text-xs text-muted">{m.privacy}</p>
    </form>
  );
}
