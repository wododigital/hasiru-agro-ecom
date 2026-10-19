'use client';

import { QtyStepper } from '@ecomkit/ui';
import { useState, useTransition } from 'react';
import { changeCartLine } from './cart-client';

/** Add / stepper on a product card. Optimistic; rolls back when the cart refuses the change. */
export function CardBuyIsland({ variantId, itemName, cta }: { variantId: string; itemName: string; cta: string }) {
  const [qty, setQty] = useState(0);
  const [pending, start] = useTransition();
  const onChange = (next: number) => {
    const prev = qty;
    setQty(next);
    start(async () => {
      const confirmed = await changeCartLine(variantId, next - prev);
      setQty(confirmed ?? prev);
    });
  };
  return <QtyStepper value={qty} onChange={onChange} itemName={itemName} cta={cta} disabled={pending} />;
}
