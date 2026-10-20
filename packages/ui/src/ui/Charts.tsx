import { barRects, sparkPoints } from '../domain/chart';
import { cn } from '../cn';

interface ChartProps {
  values: readonly number[];
  /** Accessible summary, e.g. "Orders per day, last 14 days, 3 to 18". Charts are images to screen readers. */
  label: string;
  width?: number;
  height?: number;
  className?: string;
}

export function Sparkline({ values, label, width = 120, height = 32, className }: ChartProps) {
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${width} ${height}`} width={width} height={height} preserveAspectRatio="none" className={cn('text-primary-hover', className)}>
      <polyline points={sparkPoints(values, { width, height })} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function BarChart({ values, label, width = 240, height = 80, className }: ChartProps) {
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={cn('text-primary-hover', className)}>
      {barRects(values, { width, height }).map((b, i) => (
        <rect key={i} x={b.x} y={b.y} width={b.width} height={b.height} rx={2} fill="currentColor" />
      ))}
    </svg>
  );
}
