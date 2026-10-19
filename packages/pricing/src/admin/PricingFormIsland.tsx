'use client';

import { useActionState, useState } from 'react';
import { Button, FormField, Input } from '@ecomkit/ui';
import type { AdminVariantPricing } from '../server/pricing';
import { savePricingAction } from './actions';

const rupees = (p: number | null) => (p === null ? '' : String(p / 100));

/** One variant's price form on the product's Pricing tab. Works as a plain form post before hydration. */
export function PricingFormIsland({ productId, variant }: { productId: string; variant: AdminVariantPricing }) {
  const [state, action, pending] = useActionState(savePricingAction, null);
  const [rows, setRows] = useState(Math.max(variant.tiers.length + 1, 2));
  const errors = state && !state.ok ? state.fieldErrors : {};
  const first = (k: string) => errors[k]?.[0] ?? null;
  const id = (k: string) => `pricing-${variant.variantId}-${k}`;

  return (
    <form action={action} className="flex flex-col gap-4 rounded-md border border-border bg-surface p-4" data-variant={variant.variantId}>
      <h3 className="font-semibold">{variant.label}</h3>
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="variantId" value={variant.variantId} />
      <div className="grid gap-3 sm:grid-cols-4">
        <FormField id={id('price')} label="Price (Rs, incl. GST)" required error={first('pricePaise')}>
          {(c) => <Input {...c} name="price" inputMode="decimal" defaultValue={rupees(variant.pricePaise)} required />}
        </FormField>
        <FormField id={id('compare')} label="Compare-at (Rs)" help="Real earlier price only" error={first('compareAtPaise')}>
          {(c) => <Input {...c} name="compareAt" inputMode="decimal" defaultValue={rupees(variant.compareAtPaise)} />}
        </FormField>
        <FormField id={id('offline')} label="Offline price (Rs)" help="Nursery counter price, admin only" error={first('offlinePricePaise')}>
          {(c) => <Input {...c} name="offlinePrice" inputMode="decimal" defaultValue={rupees(variant.offlinePricePaise)} />}
        </FormField>
        <FormField id={id('cost')} label="Cost (Rs)" help="Admin only" error={first('costPaise')}>
          {(c) => <Input {...c} name="cost" inputMode="decimal" defaultValue={rupees(variant.costPaise)} />}
        </FormField>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold">Bulk tiers (unit price from a quantity)</legend>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="grid grid-cols-2 gap-3 sm:max-w-md">
            <Input name="tierMinQty" inputMode="numeric" aria-label={`Tier ${i + 1} from quantity`} defaultValue={variant.tiers[i]?.minQty ?? ''} />
            <Input name="tierPrice" inputMode="decimal" aria-label={`Tier ${i + 1} unit price (Rs)`} defaultValue={rupees(variant.tiers[i]?.unitPaise ?? null)} />
          </div>
        ))}
        {first('tiers') ? <p className="text-xs font-medium text-danger">{first('tiers')}</p> : null}
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setRows((n) => n + 1)}>
          Add tier
        </Button>
      </fieldset>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          Save prices
        </Button>
        <p role="status" className="text-sm text-muted">
          {state?.ok ? (state.data.changed ? 'Saved' : 'No changes') : state?.formError === 'forbidden' ? 'You do not have permission to change prices' : ''}
        </p>
      </div>
    </form>
  );
}
