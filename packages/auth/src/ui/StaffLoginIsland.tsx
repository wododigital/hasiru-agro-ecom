'use client';

import { Button, FormField, Input } from '@ecomkit/ui';
import { useActionState, useState } from 'react';
import { authMessages } from '../messages';
import { staffLoginAction, type StaffLoginState } from '../server/actions';

const m = authMessages.staff;

function errorText(state: StaffLoginState): string | null {
  switch (state.error) {
    case 'invalid':
      return m.errors.invalid;
    case 'locked':
      return m.errors.locked(state.retryAfterSec ?? 900);
    case 'rate_limited':
      return m.errors.rateLimited(state.retryAfterSec ?? 900);
    case 'code_invalid':
      return m.errors.codeInvalid;
    case 'invite_invalid':
      return m.errors.inviteInvalid;
    default:
      return null;
  }
}

/** Staff sign-in: invite password, email + password, authenticator code or backup code, first-time authenticator setup. */
export function StaffLoginIsland({ initialStep, inviteToken }: { initialStep: StaffLoginState['step']; inviteToken?: string }) {
  const [state, action, pending] = useActionState(staffLoginAction, { step: initialStep, inviteToken, error: null });
  const [useBackup, setUseBackup] = useState(false);
  const error = errorText(state);
  const title = { password: m.title, invite: m.inviteTitle, second_factor: m.secondFactorTitle, enrol: m.enrolTitle, enrol_confirm: m.enrolTitle }[state.step];

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-3xl text-primary">{title}</h1>
      {state.notice === 'invite_done' ? (
        <p role="status" className="text-sm text-success">
          {m.inviteDone}
        </p>
      ) : null}

      {state.step === 'invite' ? (
        <form action={action} className="flex flex-col gap-4">
          <p className="text-sm text-muted">{m.inviteIntro}</p>
          <input type="hidden" name="intent" value="accept_invite" />
          <input type="hidden" name="invite" value={state.inviteToken ?? ''} />
          <FormField id="staff-new-password" label={m.newPassword} error={error} required>
            {(c) => <Input {...c} name="password" type="password" autoComplete="new-password" minLength={12} required autoFocus />}
          </FormField>
          <Button type="submit" disabled={pending} data-cta="staff-invite-set-password">
            {m.setPassword}
          </Button>
        </form>
      ) : null}

      {state.step === 'password' ? (
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="intent" value="password" />
          <FormField id="staff-email" label={m.email} required>
            {(c) => <Input {...c} name="email" type="email" autoComplete="username" required autoFocus />}
          </FormField>
          <FormField id="staff-password" label={m.password} error={error} required>
            {(c) => <Input {...c} name="password" type="password" autoComplete="current-password" required />}
          </FormField>
          <Button type="submit" disabled={pending} data-cta="staff-login-submit">
            {pending ? m.signingIn : m.signIn}
          </Button>
        </form>
      ) : null}

      {state.step === 'second_factor' ? (
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="intent" value="second_factor" />
          <input type="hidden" name="method" value={useBackup ? 'backup' : 'totp'} />
          <FormField id="staff-code" label={useBackup ? m.backupLabel : m.totpLabel} error={error} required>
            {(c) =>
              useBackup ? (
                <Input {...c} key="backup" name="code" autoComplete="off" required autoFocus />
              ) : (
                <Input {...c} key="totp" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus />
              )
            }
          </FormField>
          <Button type="submit" disabled={pending} data-cta="staff-second-factor-submit">
            {m.verify}
          </Button>
          <Button type="button" variant="link" onClick={() => setUseBackup((v) => !v)} data-cta="staff-second-factor-toggle">
            {useBackup ? m.useApp : m.useBackup}
          </Button>
        </form>
      ) : null}

      {state.step === 'enrol' ? (
        <form action={action} className="flex flex-col gap-4">
          <p className="text-sm text-muted">{m.enrolIntro}</p>
          <input type="hidden" name="intent" value="enrol_start" />
          <FormField id="staff-enrol-password" label={m.password} error={error} required>
            {(c) => <Input {...c} name="password" type="password" autoComplete="current-password" required autoFocus />}
          </FormField>
          <Button type="submit" disabled={pending} data-cta="staff-enrol-start">
            {m.enrolStart}
          </Button>
        </form>
      ) : null}

      {state.step === 'enrol_confirm' && state.enrolment ? (
        <form action={action} className="flex flex-col gap-4">
          <p className="text-sm text-muted">{m.enrolKeyIntro}</p>
          <div className="rounded-md border border-border bg-surface-2 p-3">
            <p className="text-xs font-semibold text-muted">{m.enrolKey}</p>
            <p className="font-mono text-base break-all text-text">{state.enrolment.secret}</p>
            <a href={state.enrolment.totpURI} className="mt-2 inline-block text-sm text-primary-hover underline" data-cta="staff-enrol-open-app">
              {m.enrolOpenApp}
            </a>
          </div>
          <div>
            <p className="text-sm font-semibold text-primary">{m.backupTitle}</p>
            <p className="text-xs text-muted">{m.backupHelp}</p>
            <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm">
              {state.enrolment.backupCodes.map((code) => (
                <li key={code}>{code}</li>
              ))}
            </ul>
          </div>
          <input type="hidden" name="intent" value="enrol_confirm" />
          <FormField id="staff-enrol-code" label={m.enrolConfirmLabel} error={error} required>
            {(c) => <Input {...c} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required />}
          </FormField>
          <Button type="submit" disabled={pending} data-cta="staff-enrol-confirm">
            {m.enrolConfirm}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
