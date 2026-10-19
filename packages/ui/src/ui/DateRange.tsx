'use client';

import type { DateRange as Range } from '@ecomkit/core/contracts';
import { useState } from 'react';
import { cn } from '../cn';
import { uiMessages } from '../messages';
import { fieldClass } from './Input';

export interface DateRangeProps {
  /** Field names for form posts; defaults `from` / `to`. */
  names?: { from: string; to: string };
  value?: Range;
  defaultValue?: Range;
  onChange?: (range: Range) => void;
  /** YYYY-MM-DD bounds, IST dates. */
  min?: string;
  max?: string;
  labels?: Partial<(typeof uiMessages)['dateRange']>;
  className?: string;
}

/** Two native date inputs (no picker library). `to` cannot precede `from`. */
export function DateRange({ names = { from: 'from', to: 'to' }, value, defaultValue, onChange, min, max, labels, className }: DateRangeProps) {
  const l = { ...uiMessages.dateRange, ...labels };
  const [inner, setInner] = useState<Range>(value ?? defaultValue ?? { from: '', to: '' });
  const range = value ?? inner;
  const update = (patch: Partial<Range>) => {
    const next = { ...range, ...patch };
    if (next.from && next.to && next.to < next.from) next.to = next.from;
    setInner(next);
    onChange?.(next);
  };
  return (
    <div className={cn('flex flex-wrap items-end gap-2', className)}>
      <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
        {l.from}
        <input type="date" name={names.from} value={range.from} min={min} max={range.to || max} onChange={(e) => update({ from: e.target.value })} className={cn(fieldClass, 'w-auto py-1.5')} />
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
        {l.to}
        <input type="date" name={names.to} value={range.to} min={range.from || min} max={max} onChange={(e) => update({ to: e.target.value })} className={cn(fieldClass, 'w-auto py-1.5')} />
      </label>
    </div>
  );
}
