import type { ReactNode } from 'react';
import { cn } from '../cn';

export interface StatProps {
  label: ReactNode;
  value: ReactNode;
  /** Change text, e.g. "+12% vs last week"; colour from `trend`. */
  delta?: ReactNode;
  trend?: 'up' | 'down' | 'flat';
  /** Usually a Sparkline. */
  chart?: ReactNode;
  className?: string;
}

export function Stat({ label, value, delta, trend = 'flat', chart, className }: StatProps) {
  return (
    <div className={cn('flex flex-col gap-1 rounded-md bg-surface p-4 shadow-card', className)}>
      <p className="text-sm text-muted">{label}</p>
      <p className="text-2xl font-semibold text-text tabular-nums">{value}</p>
      {delta ? <p className={cn('text-xs font-medium', trend === 'up' && 'text-success', trend === 'down' && 'text-danger', trend === 'flat' && 'text-muted')}>{delta}</p> : null}
      {chart}
    </div>
  );
}
