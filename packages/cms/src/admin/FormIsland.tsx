'use client';

import type { ActionResult } from '@ecomkit/core/validation';
import { Button } from '@ecomkit/ui';
import { useState, useTransition, type ReactNode } from 'react';

const FORM_ERRORS: Record<string, string> = {
  forbidden: 'You do not have permission to change content.',
  not_found: 'This entry no longer exists.',
  invalid: 'Some fields need attention.',
};

/**
 * Submits through a transition instead of a form action so a validation error keeps everything the admin typed
 * (React resets uncontrolled fields after a form action). Success redirects from the server action.
 */
export function FormIsland({ action, children, submitLabel = 'Save' }: { action: (form: FormData) => Promise<ActionResult<void>>; children: ReactNode; submitLabel?: string }) {
  const [state, setState] = useState<ActionResult<void> | null>(null);
  const [pending, start] = useTransition();
  const errors = state && !state.ok ? Object.entries(state.fieldErrors) : [];
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        start(async () => setState(await action(form)));
      }}
    >
      {state && !state.ok ? (
        <div role="alert" className="rounded-md border border-danger bg-surface px-3 py-2 text-sm text-danger">
          <p className="font-semibold">{FORM_ERRORS[state.formError ?? 'invalid'] ?? FORM_ERRORS.invalid}</p>
          {errors.length ? (
            <ul className="mt-1 list-disc pl-5">
              {errors.map(([field, messages]) => (
                <li key={field}>{`${field}: ${messages.join(', ')}`}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {children}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
