import type { DateRange as Range } from '@ecomkit/core/contracts';
import { cn } from '../cn';
import type { CompareMode } from '../domain/range';
import { uiMessages } from '../messages';
import { Button } from './Button';
import { DateRange } from './DateRange';
import { fieldClass } from './Input';

export interface RangeBarProps {
  /** The page the GET form submits to. */
  action: string;
  range: Range;
  compare: CompareMode;
  /** The comparison window (from `compareRange`), shown under the bar. */
  compared?: Range | null;
  /** Extra query params to keep (e.g. a report id). */
  keep?: Readonly<Record<string, string>>;
  labels?: Partial<(typeof uiMessages)['dateRange']>;
  className?: string;
}

/** Date range + "Compare to" for admin pages (Shopify): a plain GET form, so the state lives in the URL and works without JS. */
export function RangeBar({ action, range, compare, compared, keep = {}, labels, className }: RangeBarProps) {
  const l = { ...uiMessages.dateRange, ...labels };
  return (
    <div className={cn('flex flex-col items-end gap-1', className)}>
      <form method="get" action={action} className="flex flex-wrap items-end gap-2">
        {Object.entries(keep).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <DateRange defaultValue={range} labels={labels} />
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          {l.compare}
          <select name="compare" defaultValue={compare} className={cn(fieldClass, 'w-auto py-1.5')}>
            <option value="previous-period">{l.previousPeriod}</option>
            <option value="previous-year">{l.previousYear}</option>
            <option value="none">{l.none}</option>
          </select>
        </label>
        <Button type="submit" size="sm" variant="outline" data-cta="range-apply">
          {l.apply}
        </Button>
      </form>
      {compared ? <p className="text-xs text-muted">{l.compared(range.from, range.to, compared.from, compared.to)}</p> : null}
    </div>
  );
}
