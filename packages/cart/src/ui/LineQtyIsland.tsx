'use client';

import { QtyStepper } from '@ecomkit/ui';
import { useOptimistic, useTransition } from 'react';
import { CART_CHANGED_EVENT } from './events';
import { setLineQtyAction } from '../server/actions';

/** Cart line stepper: shows the new quantity at once, then the refreshed page replaces it; other cart widgets hear `cart:changed` (0 removes the line). */
export function LineQtyIsland({ lineId, qty, itemName }: { lineId: string; qty: number; itemName: string }) {
  const [shown, setShown] = useOptimistic(qty);
  const [pending, start] = useTransition();
  const onChange = (next: number) =>
    start(async () => {
      setShown(next);
      await setLineQtyAction(lineId, next);
      window.dispatchEvent(new CustomEvent(CART_CHANGED_EVENT));
    });
  return <QtyStepper value={shown} onChange={onChange} min={0} addButton={false} itemName={itemName} disabled={pending} tone="light" />;
}
