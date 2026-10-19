import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../cn';

/** Use `buttonVariants()` to style a Link as a button: `<Link className={buttonVariants({ variant: 'accent' })}>`. */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap transition-[background-color,color,transform] active:scale-[.97] disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-fg hover:bg-primary-hover',
        accent: 'bg-accent text-accent-fg hover:bg-accent/85',
        outline: 'border-[1.5px] border-primary text-primary hover:bg-primary hover:text-primary-fg',
        subtle: 'bg-surface-2 text-text hover:bg-border',
        ghost: 'text-primary hover:bg-surface-2',
        danger: 'bg-danger text-primary-fg hover:bg-danger/90',
        link: 'rounded-none px-0 text-primary-hover underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-9 px-3.5 text-sm',
        md: 'h-11 px-5 text-base',
        lg: 'h-12 px-6 text-lg',
        icon: 'size-10 p-0',
      },
    },
    compoundVariants: [{ variant: 'link', className: 'h-auto px-0' }],
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = ComponentProps<'button'> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
