'use client';

import { Button, FormField, Input } from '@ecomkit/ui';
import { useActionState } from 'react';
import { clearOverrideAction, setCountAction, setLevelSettingsAction, type AdminActionState } from './actions';

export interface LevelFormsIslandProps {
  variantId: string;
  productId: string;
  onHand: number;
  lowStockThreshold: number | null;
  readyInDays: number | null;
  manual: boolean;
}

function Result({ state }: { state: AdminActionState }) {
  if (!state) return null;
  return (
    <p role={state.ok ? 'status' : 'alert'} className={state.ok ? 'text-sm text-success' : 'text-sm font-medium text-danger'}>
      {state.message}
    </p>
  );
}

/** Count, thresholds and Clear override for one variant. Used on the detail page and in the product form tab. */
export function LevelFormsIsland({ variantId, productId, onHand, lowStockThreshold, readyInDays, manual }: LevelFormsIslandProps) {
  const [countState, countAction, countPending] = useActionState(setCountAction, null);
  const [settingsState, settingsAction, settingsPending] = useActionState(setLevelSettingsAction, null);
  const [clearState, clearAction, clearPending] = useActionState(clearOverrideAction, null);
  const f = (name: string) => `${variantId}-${name}`;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <form action={countAction} className="flex flex-col gap-3">
        <input type="hidden" name="variantId" value={variantId} />
        <input type="hidden" name="productId" value={productId} />
        <FormField id={f('onHand')} label="Counted on hand" help="Saving makes this a manual override: ERP pulls will not change it until you clear the override.">
          {(c) => <Input {...c} name="onHand" type="number" min={0} step={1} defaultValue={onHand} required />}
        </FormField>
        <FormField id={f('note')} label="Note">
          {(c) => <Input {...c} name="note" maxLength={500} placeholder="Recount, damage write-off" />}
        </FormField>
        <Button type="submit" size="sm" disabled={countPending}>
          Save count
        </Button>
        <Result state={countState} />
      </form>
      <div className="flex flex-col gap-3">
        <form action={settingsAction} className="flex flex-col gap-3">
          <input type="hidden" name="variantId" value={variantId} />
          <FormField id={f('threshold')} label="Low-stock threshold" help="Empty uses the store default.">
            {(c) => <Input {...c} name="lowStockThreshold" type="number" min={0} step={1} defaultValue={lowStockThreshold ?? ''} />}
          </FormField>
          <FormField id={f('ready')} label="Ready in days" help="When nothing is sellable, a value here shows the product as preorder.">
            {(c) => <Input {...c} name="readyInDays" type="number" min={0} step={1} defaultValue={readyInDays ?? ''} />}
          </FormField>
          <Button type="submit" size="sm" variant="subtle" disabled={settingsPending}>
            Save settings
          </Button>
          <Result state={settingsState} />
        </form>
        {manual ? (
          <form action={clearAction} className="flex flex-col gap-2">
            <input type="hidden" name="variantId" value={variantId} />
            <Button type="submit" size="sm" variant="outline" disabled={clearPending}>
              Clear override
            </Button>
            <Result state={clearState} />
          </form>
        ) : null}
      </div>
    </div>
  );
}
