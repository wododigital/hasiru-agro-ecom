import type { ReactNode } from 'react';
import { cn } from '../cn';

export interface EmptyStateProps {
  title: ReactNode;
  body?: ReactNode;
  icon?: ReactNode;
  /** Usually a Button or a Link styled with buttonVariants. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, body, icon, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-10 text-center', className)}>
      {icon ? <div className="grid size-12 place-items-center rounded-full bg-surface-2 text-primary [&_svg]:size-6">{icon}</div> : null}
      <p className="text-lg font-semibold text-primary">{title}</p>
      {body ? <p className="max-w-md text-sm text-muted">{body}</p> : null}
      {action}
    </div>
  );
}
