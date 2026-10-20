'use client';

import { Button, Input } from '@ecomkit/ui';
import { useActionState } from 'react';
import { applyCouponAction, type CouponActionState } from '../server/actions';

export interface CouponLabels {
  label: string;
  placeholder: string;
  apply: string;
  reasons: Record<string, string>;
}

/** Coupon field. Works as a plain form post too; with JS the refusal reason shows in place. */
export function CouponIsland({ labels }: { labels: CouponLabels }) {
  const [state, action, pending] = useActionState<CouponActionState, FormData>(applyCouponAction, null);
  const error = state && !state.ok ? (labels.reasons[state.reason ?? 'invalid'] ?? labels.reasons.invalid) : null;
  return (
    <form action={action} className="flex flex-col gap-1">
      <label htmlFor="cart-coupon" className="text-sm font-medium">
        {labels.label}
      </label>
      <div className="flex gap-2">
        <Input id="cart-coupon" name="code" autoComplete="off" autoCapitalize="characters" maxLength={40} placeholder={labels.placeholder} aria-invalid={!!error} aria-describedby={error ? 'cart-coupon-error' : undefined} />
        <Button type="submit" variant="outline" size="sm" className="h-11" disabled={pending} data-cta="cart-apply-coupon">
          {labels.apply}
        </Button>
      </div>
      {error ? (
        <p id="cart-coupon-error" role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </form>
  );
}
