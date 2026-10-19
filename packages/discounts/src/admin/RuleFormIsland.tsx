'use client';

import { useActionState } from 'react';
import { Button, Checkbox, FormField, Input, Select, Textarea } from '@ecomkit/ui';
import { saveRuleAction } from './actions';

export interface RuleFormDefaults {
  id: string | null;
  name: string;
  kind: 'automatic' | 'code';
  status: string;
  startsAt: string;
  endsAt: string;
  valueType: 'percent' | 'fixed';
  value: string;
  appliesTo: string;
  targetIds: string;
  minQty: string;
  minSubtotal: string;
  customerEligibility: string;
  segmentId: string;
  usageLimitTotal: string;
  usageLimitPerCustomer: string;
  stackable: boolean;
  priority: string;
  descriptionPublic: string;
}

const options = (values: readonly [string, string][]) => values.map(([v, l]) => <option key={v} value={v}>{l}</option>);

/** Create or edit a discount rule. Dates are India time. */
export function RuleFormIsland({ defaults }: { defaults: RuleFormDefaults }) {
  const [state, action, pending] = useActionState(saveRuleAction, null);
  const errors = state && !state.ok ? state.fieldErrors : {};
  const err = (k: string) => errors[k]?.[0] ?? null;
  const d = defaults;

  return (
    <form action={action} className="flex max-w-3xl flex-col gap-4">
      {d.id ? <input type="hidden" name="id" value={d.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="name" label="Internal name" required error={err('name')}>
          {(c) => <Input {...c} name="name" defaultValue={d.name} required />}
        </FormField>
        <FormField id="descriptionPublic" label="Shown to customers" help="On the cart and receipt; the internal name is used when empty" error={err('descriptionPublic')}>
          {(c) => <Input {...c} name="descriptionPublic" defaultValue={d.descriptionPublic} />}
        </FormField>
        <FormField id="kind" label="Type" error={err('kind')}>
          {(c) => <Select {...c} name="kind" defaultValue={d.kind} disabled={!!d.id}>{options([['automatic', 'Automatic promotion'], ['code', 'Coupon code']])}</Select>}
        </FormField>
        {d.id ? <input type="hidden" name="kind" value={d.kind} /> : null}
        <FormField id="status" label="Status" error={err('status')}>
          {(c) => <Select {...c} name="status" defaultValue={d.status}>{options([['draft', 'Draft'], ['active', 'Active'], ['paused', 'Paused'], ['archived', 'Archived']])}</Select>}
        </FormField>
        <FormField id="startsAt" label="Starts (IST)" help="Empty starts now" error={err('startsAt')}>
          {(c) => <Input {...c} type="datetime-local" name="startsAt" defaultValue={d.startsAt} />}
        </FormField>
        <FormField id="endsAt" label="Ends (IST)" help="Empty runs until paused" error={err('endsAt')}>
          {(c) => <Input {...c} type="datetime-local" name="endsAt" defaultValue={d.endsAt} />}
        </FormField>
        <FormField id="valueType" label="Discount" error={err('valueType')}>
          {(c) => <Select {...c} name="valueType" defaultValue={d.valueType}>{options([['percent', 'Percent off'], ['fixed', 'Fixed amount off (Rs)']])}</Select>}
        </FormField>
        <FormField id="value" label="Value" help="Percent (1 to 100) or rupees" required error={err('value')}>
          {(c) => <Input {...c} name="value" inputMode="decimal" defaultValue={d.value} required />}
        </FormField>
        <FormField id="appliesTo" label="Applies to" error={err('appliesTo')}>
          {(c) => <Select {...c} name="appliesTo" defaultValue={d.appliesTo}>{options([['order', 'Whole order'], ['collection', 'Collections'], ['products', 'Products'], ['tags', 'Tags']])}</Select>}
        </FormField>
        <FormField id="targetIds" label="Target ids" help="Collection, product or tag ids, one per line" error={err('targetIds')}>
          {(c) => <Textarea {...c} name="targetIds" defaultValue={d.targetIds} />}
        </FormField>
        <FormField id="minQty" label="Minimum items" error={err('minQty')}>
          {(c) => <Input {...c} name="minQty" inputMode="numeric" defaultValue={d.minQty} />}
        </FormField>
        <FormField id="minSubtotal" label="Minimum spend (Rs)" help="Of the matching items, after bulk prices" error={err('minSubtotalPaise')}>
          {(c) => <Input {...c} name="minSubtotal" inputMode="decimal" defaultValue={d.minSubtotal} />}
        </FormField>
        <FormField id="customerEligibility" label="Customers" error={err('customerEligibility')}>
          {(c) => <Select {...c} name="customerEligibility" defaultValue={d.customerEligibility}>{options([['all', 'Everyone'], ['first_order', 'First order only'], ['segment', 'A segment']])}</Select>}
        </FormField>
        <FormField id="segmentId" label="Segment" error={err('segmentId')}>
          {(c) => <Input {...c} name="segmentId" defaultValue={d.segmentId} />}
        </FormField>
        <FormField id="usageLimitTotal" label="Total uses" help="Empty for no limit" error={err('usageLimitTotal')}>
          {(c) => <Input {...c} name="usageLimitTotal" inputMode="numeric" defaultValue={d.usageLimitTotal} />}
        </FormField>
        <FormField id="usageLimitPerCustomer" label="Uses per customer" help="Counted by phone" error={err('usageLimitPerCustomer')}>
          {(c) => <Input {...c} name="usageLimitPerCustomer" inputMode="numeric" defaultValue={d.usageLimitPerCustomer} />}
        </FormField>
        <FormField id="priority" label="Priority" help="Higher wins a tie between promotions" error={err('priority')}>
          {(c) => <Input {...c} name="priority" inputMode="numeric" defaultValue={d.priority} />}
        </FormField>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox name="stackable" defaultChecked={d.stackable} />
        Combines with a coupon code (otherwise the customer gets the better of the two)
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          Save discount
        </Button>
        <p role="status" className="text-sm text-muted">
          {state?.ok ? 'Saved' : state?.formError === 'forbidden' ? 'You do not have permission to change discounts' : ''}
        </p>
      </div>
    </form>
  );
}
