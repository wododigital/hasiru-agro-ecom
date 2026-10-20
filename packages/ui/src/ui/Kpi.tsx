import Link from 'next/link';
import type { ReactNode } from 'react';
import { delta } from '../domain/range';
import { uiMessages } from '../messages';
import { Sparkline } from './Charts';
import { Stat } from './Stat';

export interface KpiProps {
  label: string;
  /** Formatted current value. */
  value: ReactNode;
  /** Raw numbers for the change line; `previous` null hides it (no comparison chosen). */
  current: number;
  previous: number | null;
  /** One value per day of the range, for the sparkline. */
  series?: readonly number[];
  /** A falling number that is good news (e.g. refunds) flips the colour. */
  lowerIsBetter?: boolean;
  /** Report page the card opens. */
  href?: string;
  labels?: Partial<(typeof uiMessages)['kpi']>;
}

/** KPI card (Shopify Home / Analytics): value, change against the comparison window, sparkline. */
export function Kpi({ label, value, current, previous, series, lowerIsBetter = false, href, labels }: KpiProps) {
  const l = { ...uiMessages.kpi, ...labels };
  const d = previous === null ? undefined : delta(current, previous);
  const text = d === undefined ? undefined : d === null ? (current > 0 ? l.isNew : undefined) : `${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)}% ${l.vs}`;
  const up = d !== undefined && d !== null && d > 0;
  const down = d !== undefined && d !== null && d < 0;
  const trend = up ? (lowerIsBetter ? 'down' : 'up') : down ? (lowerIsBetter ? 'up' : 'down') : 'flat';
  const stat = (
    <Stat
      label={label}
      value={value}
      delta={text}
      trend={trend}
      chart={series?.length ? <Sparkline values={series} label={l.trend(label)} width={160} height={36} className="mt-1 h-9 w-full" /> : null}
      className="h-full border border-border shadow-none"
    />
  );
  return href ? (
    <Link href={href} className="block h-full rounded-md hover:ring-2 hover:ring-primary/30" data-cta={`kpi-${label.toLowerCase().replace(/\W+/g, '-')}`}>
      {stat}
    </Link>
  ) : (
    stat
  );
}
