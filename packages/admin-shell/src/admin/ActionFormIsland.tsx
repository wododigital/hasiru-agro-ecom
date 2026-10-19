'use client';

import { Button, cn, toast, type ButtonProps } from '@ecomkit/ui';
import { useActionState, useEffect, type ReactNode } from 'react';
import { IDLE, type FormState } from '../domain';

export type FormAction = (prev: FormState, form: FormData) => Promise<FormState>;

export interface ActionFormProps {
  action: FormAction;
  /** Fields; a function gets the last result so fields can show their own errors. */
  children: ReactNode | ((state: FormState) => ReactNode);
  submitLabel: string;
  submitVariant?: ButtonProps['variant'];
  /** Field labels for the error summary (field name -> label). */
  labels?: Record<string, string>;
  /** Hide the error summary when the fields render their own errors. */
  inlineErrors?: boolean;
  disabled?: boolean;
  className?: string;
  cta?: string;
}

/**
 * The one admin form: posts to a server action (works without JS), announces the result in a toast and an
 * alert region, and lists field errors. Used by settings, staff and roles screens.
 */
export function ActionForm({ action, children, submitLabel, submitVariant = 'primary', labels = {}, inlineErrors, disabled, className, cta }: ActionFormProps) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  useEffect(() => {
    if (state.message) (state.ok ? toast.success : toast.error)(state.message);
  }, [state]);
  const errors = Object.entries(state.fieldErrors ?? {});
  return (
    <form action={formAction} className={cn('flex flex-col gap-4', className)}>
      {typeof children === 'function' ? children(state) : children}
      {!state.ok && state.message ? (
        <div role="alert" className="rounded-sm border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">
          <p>{state.message}</p>
          {!inlineErrors && errors.length ? (
            <ul className="mt-1 list-disc pl-5">
              {errors.map(([key, messages]) => (
                <li key={key}>{`${labels[key] ?? key}: ${messages.join(', ')}`}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <div>
        <Button type="submit" variant={submitVariant} size="sm" disabled={disabled || pending} aria-busy={pending} data-cta={cta}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
