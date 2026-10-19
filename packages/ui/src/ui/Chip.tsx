import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../cn';
import { uiMessages } from '../messages';

export interface ChipProps {
  children: ReactNode;
  icon?: ReactNode;
  /** `spec` = small attribute chip on cards; `filter` = applied filter with a remove button. */
  variant?: 'spec' | 'filter';
  /** Filter chips: when given, renders a remove button (client callers only). */
  onRemove?: () => void;
  removeLabel?: string;
  className?: string;
}

export function Chip({ children, icon, variant = 'spec', onRemove, removeLabel = uiMessages.common.remove, className }: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap',
        variant === 'spec' ? 'rounded-[6px] bg-surface-2 px-1.5 py-0.5 text-xs text-text' : 'rounded-full border border-border bg-surface py-1 pr-1 pl-3 text-sm font-medium text-primary',
        className,
      )}
    >
      {icon}
      {children}
      {onRemove ? (
        <button type="button" onClick={onRemove} aria-label={removeLabel} className="grid size-6 place-items-center rounded-full hover:bg-surface-2">
          <X aria-hidden="true" className="size-3.5" />
        </button>
      ) : null}
    </span>
  );
}
