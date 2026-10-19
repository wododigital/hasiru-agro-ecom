'use client';

import { Minus, Plus } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { cn } from '../cn';
import { QTY_CHIPS, clampQty, decrementQty, incrementQty, parseQty, showQuickChips, type QtyBounds } from '../domain/qty';
import { uiMessages } from '../messages';

export interface QtyStepperProps extends QtyBounds {
  value: number;
  onChange: (qty: number) => void;
  /** At 0 show the Add button instead of the stepper (cards). Off for cart lines that keep the stepper. */
  addButton?: boolean;
  /** Quantity the Add button sets. */
  addQty?: number;
  /** +10 / +50 chips once qty reaches 10. */
  quickChips?: boolean;
  tone?: 'solid' | 'light';
  /** Names the product for screen readers, e.g. "Alphonso mango". */
  itemName?: string;
  labels?: Partial<(typeof uiMessages)['qty']>;
  disabled?: boolean;
  className?: string;
  /** data-cta id on the Add button. */
  cta?: string;
}

export function QtyStepper({
  value,
  onChange,
  min,
  max,
  addButton = true,
  addQty = 1,
  quickChips = true,
  tone = 'solid',
  itemName,
  labels,
  disabled,
  className,
  cta,
}: QtyStepperProps) {
  const l = { ...uiMessages.qty, ...labels };
  const bounds = { min, max };
  const [draft, setDraft] = useState<string | null>(null);
  const suffix = itemName ? `, ${itemName}` : '';
  const addLabel = itemName ? l.add + suffix : undefined;
  const groupLabel = l.quantity + suffix;

  const set = (n: number) => {
    setDraft(null);
    const next = clampQty(n, bounds);
    if (next !== value) onChange(next);
  };
  const commit = () => {
    if (draft === null) return;
    const parsed = parseQty(draft, bounds);
    setDraft(null);
    if (parsed !== null && parsed !== value) onChange(parsed);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') setDraft(null);
  };

  if (addButton && value <= 0) {
    return (
      <button
        type="button"
        disabled={disabled}
        data-cta={cta}
        onClick={() => set(addQty)}
        aria-label={addLabel}
        className={cn('h-9 rounded-sm bg-primary px-4 text-sm font-semibold text-primary-fg hover:bg-primary-hover disabled:opacity-45', className)}
      >
        {l.add}
      </button>
    );
  }

  // Focus rings sit inside the pill; on the solid tone they use the foreground colour to stay visible.
  const shell = cn('[&_:focus-visible]:outline-offset-[-3px]', tone === 'solid' ? 'bg-primary text-primary-fg [&_:focus-visible]:outline-primary-fg' : 'bg-surface-2 text-primary-strong');
  const hover = tone === 'solid' ? 'hover:bg-primary-hover' : 'hover:bg-border';
  return (
    <div className={cn('inline-flex flex-col items-end gap-1', className)}>
      <div role="group" aria-label={groupLabel} className={cn('inline-flex h-9 items-center overflow-hidden rounded-sm', shell)}>
        <button type="button" disabled={disabled || value <= Math.max(0, min ?? 0)} onClick={() => set(decrementQty(value, bounds))} aria-label={l.decrease} className={cn('grid h-full w-8 place-items-center disabled:opacity-45', hover)}>
          <Minus aria-hidden="true" className="size-4" />
        </button>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          aria-label={l.quantity}
          disabled={disabled}
          value={draft ?? String(value)}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={commit}
          onFocus={(e) => e.target.select()}
          className="h-full w-12 bg-transparent text-center font-semibold tabular-nums"
        />
        <button type="button" disabled={disabled || (max !== undefined && value >= max)} onClick={() => set(incrementQty(value, bounds))} aria-label={l.increase} className={cn('grid h-full w-8 place-items-center disabled:opacity-45', hover)}>
          <Plus aria-hidden="true" className="size-4" />
        </button>
      </div>
      {quickChips && showQuickChips(value) ? (
        <div className="flex gap-1">
          {QTY_CHIPS.map((n) => (
            <button key={n} type="button" disabled={disabled} onClick={() => set(value + n)} aria-label={l.addMany(n)} className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-semibold text-primary hover:bg-surface-2">
              +{n}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
