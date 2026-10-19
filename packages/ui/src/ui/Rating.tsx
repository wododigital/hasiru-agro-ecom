import { RATING_MIN_REVIEWS } from '@ecomkit/core/contracts';
import { Star } from 'lucide-react';
import { cn } from '../cn';
import { uiMessages } from '../messages';
import { Badge } from './Badge';

export interface RatingProps {
  average: number | null;
  count: number;
  labels?: Partial<(typeof uiMessages)['rating']>;
  className?: string;
}

/** Stars only with RATING_MIN_REVIEWS or more approved reviews; otherwise the "New" chip (A13). */
export function Rating({ average, count, labels, className }: RatingProps) {
  const l = { ...uiMessages.rating, ...labels };
  if (average == null || count < RATING_MIN_REVIEWS) {
    return (
      <Badge tone="outline" className={className}>
        {l.newChip}
      </Badge>
    );
  }
  const filled = Math.round(average);
  return (
    <span role="img" aria-label={l.summary(average, count)} className={cn('inline-flex items-center gap-0.5 text-warning', className)}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} aria-hidden="true" className={cn('size-3.5', i <= filled ? 'fill-current' : 'opacity-35')} />
      ))}
      <span aria-hidden="true" className="ml-1 text-xs text-muted tabular-nums">
        {average.toFixed(1)}
      </span>
    </span>
  );
}
