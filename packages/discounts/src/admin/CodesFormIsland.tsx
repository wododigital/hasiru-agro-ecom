'use client';

import { useActionState } from 'react';
import { Button, FormField, Input, Textarea } from '@ecomkit/ui';
import { addCodesAction } from './actions';

/** Paste codes or generate a batch for a coupon rule. */
export function CodesFormIsland({ ruleId }: { ruleId: string }) {
  const [state, action, pending] = useActionState(addCodesAction, null);
  const err = state && !state.ok ? (state.fieldErrors.codes?.[0] ?? state.fieldErrors.generate?.[0] ?? null) : null;
  return (
    <form action={action} className="flex max-w-3xl flex-col gap-3">
      <input type="hidden" name="ruleId" value={ruleId} />
      <FormField id="codes" label="Codes" help="One per line; letters, digits, - and _" error={err}>
        {(c) => <Textarea {...c} name="codes" />}
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="generate" label="Or generate this many">
          {(c) => <Input {...c} name="generate" inputMode="numeric" />}
        </FormField>
        <FormField id="prefix" label="With prefix">
          {(c) => <Input {...c} name="prefix" />}
        </FormField>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          Add codes
        </Button>
        <p role="status" className="text-sm text-muted">
          {state?.ok
            ? state.data.error ?? `Added ${state.data.added.length}${state.data.skipped.length ? `, skipped ${state.data.skipped.length} that already exist` : ''}`
            : state?.formError === 'forbidden'
              ? 'You do not have permission to change discounts'
              : ''}
        </p>
      </div>
    </form>
  );
}
