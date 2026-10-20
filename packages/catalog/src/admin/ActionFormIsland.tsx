'use client';

import { Button, cn, SaveBarIsland } from '@ecomkit/ui';
import { useActionState, type ReactNode } from 'react';
import type { FormState } from './form-state';

/** Admin form shell: posts to a server action, shows the result and any field errors. Fields are server-rendered children. */
export function ActionFormIsland({
  action,
  children,
  submitLabel,
  variant = 'primary',
  className,
  cta,
  saveBar = false,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  children: ReactNode;
  submitLabel: string;
  variant?: 'primary' | 'outline' | 'danger' | 'subtle';
  className?: string;
  cta?: string;
  /** Sticky "Unsaved changes" bar (Shopify) on edit forms. */
  saveBar?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className={cn('flex flex-col gap-3', className)}>
      {saveBar ? <SaveBarIsland saveLabel={submitLabel} pending={pending} /> : null}
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant={variant} size="sm" disabled={pending} data-cta={cta}>
          {submitLabel}
        </Button>
        {state ? (
          <p role="status" className={cn('text-sm', state.ok ? 'text-success' : 'text-danger')}>
            {state.message}
          </p>
        ) : null}
      </div>
      {state?.fieldErrors ? (
        <ul className="text-sm text-danger">
          {Object.entries(state.fieldErrors).map(([k, v]) => (
            <li key={k}>
              {k}: {v.join(', ')}
            </li>
          ))}
        </ul>
      ) : null}
      {state?.report?.errors.length ? (
        <ul className="max-h-64 overflow-auto text-sm text-danger">
          {state.report.errors.map((e) => (
            <li key={`${e.row}-${e.message}`}>
              Row {e.row}: {e.message}
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
