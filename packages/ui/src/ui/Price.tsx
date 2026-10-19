import { formatINR } from '@ecomkit/core/money';
import type { Paise } from '@ecomkit/core/contracts';
import { cn } from '../cn';
import { uiMessages } from '../messages';

export interface PriceProps {
  paise: Paise;
  /** Real previous price only (A13 / F2); shown struck when higher than `paise`. Never enters totals. */
  compareAtPaise?: Paise | null;
  size?: 'sm' | 'md' | 'lg';
  labels?: Partial<(typeof uiMessages)['price']>;
  className?: string;
}

/** The only place money is rendered. Formatting is core.money.formatINR ("Rs 2,499", en-IN grouping). */
export function Price({ paise, compareAtPaise, size = 'md', labels, className }: PriceProps) {
  const l = { ...uiMessages.price, ...labels };
  const struck = compareAtPaise != null && compareAtPaise > paise;
  return (
    <span className={cn('inline-flex flex-wrap items-baseline gap-1.5', className)}>
      {struck ? <span className="sr-only">{l.now}</span> : null}
      <b className={cn('font-semibold text-primary-strong tabular-nums', size === 'sm' && 'text-sm', size === 'md' && 'text-lg', size === 'lg' && 'text-2xl')}>{formatINR(paise)}</b>
      {struck ? (
        <s className="text-xs text-muted tabular-nums">
          <span className="sr-only">{l.was}</span>
          {formatINR(compareAtPaise)}
        </s>
      ) : null}
    </span>
  );
}
