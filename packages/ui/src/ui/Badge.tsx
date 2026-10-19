import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../cn';

export const badgeVariants = cva('inline-flex items-center gap-1 rounded-[6px] px-2 py-0.5 text-xs font-semibold whitespace-nowrap', {
  variants: {
    tone: {
      primary: 'bg-primary text-primary-fg',
      accent: 'bg-accent text-accent-fg',
      neutral: 'bg-surface-2 text-text',
      success: 'bg-success/12 text-success',
      warning: 'bg-warning/12 text-warning',
      danger: 'bg-danger/12 text-danger',
      outline: 'border border-border text-muted',
    },
  },
  defaultVariants: { tone: 'primary' },
});

export type BadgeProps = ComponentProps<'span'> & VariantProps<typeof badgeVariants>;

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
