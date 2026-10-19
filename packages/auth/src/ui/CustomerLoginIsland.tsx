'use client';

import { Button, FormField, Input } from '@ecomkit/ui';
import { useActionState } from 'react';
import { authMessages } from '../messages';
import { customerLoginAction, type CustomerLoginState } from '../server/actions';

const initial: CustomerLoginState = { step: 'start', identifier: '', error: null };

/** Two steps on one page: identifier (phone or email), then the 6-digit code. Works as plain form posts without JS. */
// Copy comes from the module messages (a client island cannot take message functions as props).
export function CustomerLoginIsland({ next }: { next: string }) {
  const [state, action, pending] = useActionState(customerLoginAction, initial);
  const m = authMessages.login;
  const rateLimited = state.error === 'rate_limited' ? m.errors.rateLimited(state.retryAfterSec ?? 60) : null;

  if (state.step === 'start') {
    return (
      <form action={action} className="flex flex-col gap-4" noValidate>
        <input type="hidden" name="intent" value="send" />
        <FormField
          id="login-identifier"
          label={m.identifierLabel}
          help={m.identifierHelp}
          error={state.error === 'invalid_identifier' ? m.errors.invalidIdentifier : rateLimited}
          required
        >
          {(control) => (
            <Input
              {...control}
              name="identifier"
              type="text"
              autoComplete="username"
              defaultValue={state.identifier}
              placeholder={m.identifierPlaceholder}
              required
              autoFocus
            />
          )}
        </FormField>
        <Button type="submit" disabled={pending} data-cta="account-login-send-code">
          {pending ? m.sending : m.sendCode}
        </Button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p role="status" className="text-sm text-muted">
        {state.resent ? m.resent : m.codeSentTo(state.identifier)}
      </p>
      <form action={action} className="flex flex-col gap-4" noValidate>
        <input type="hidden" name="intent" value="verify" />
        <input type="hidden" name="identifier" value={state.identifier} />
        <input type="hidden" name="next" value={next} />
        <FormField id="login-code" label={m.codeLabel} error={state.error === 'invalid_code' ? m.errors.invalidCode : rateLimited} required>
          {(control) => (
            <Input
              {...control}
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              className="max-w-48 text-center text-lg tracking-[0.4em]"
              required
              autoFocus
            />
          )}
        </FormField>
        <Button type="submit" disabled={pending} data-cta="account-login-verify">
          {pending ? m.verifying : m.verify}
        </Button>
      </form>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        <form action={action}>
          <input type="hidden" name="intent" value="send" />
          <input type="hidden" name="identifier" value={state.identifier} />
          <Button type="submit" variant="link" disabled={pending} data-cta="account-login-resend">
            {m.resend}
          </Button>
        </form>
        <form action={action}>
          <input type="hidden" name="intent" value="reset" />
          <Button type="submit" variant="link" disabled={pending} data-cta="account-login-change">
            {m.changeIdentifier}
          </Button>
        </form>
      </div>
    </div>
  );
}
