import type { ComponentProps } from 'react';
import { cn } from '../cn';

export const fieldClass =
  'w-full rounded-sm border-[1.5px] border-border bg-surface px-3 py-2.5 text-text placeholder:text-muted outline-none transition-colors focus-visible:border-primary-hover focus-visible:outline-none aria-invalid:border-danger disabled:opacity-60';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(fieldClass, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(fieldClass, 'min-h-24', className)} {...props} />;
}

/** Native select: best on phones, no portal, works without JS. */
export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(fieldClass, 'appearance-auto pr-8', className)} {...props} />;
}

export function Checkbox({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return <input type="checkbox" className={cn('size-4 accent-[var(--color-primary)]', className)} {...props} />;
}
