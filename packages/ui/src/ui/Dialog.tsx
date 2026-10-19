'use client';

import { X } from 'lucide-react';
import { Dialog as D } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../cn';
import { uiMessages } from '../messages';

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

const sides = {
  center:
    'left-1/2 top-1/2 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
  bottom: 'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-lg data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
  right: 'inset-y-0 right-0 h-full w-[min(26rem,100%)] data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
  left: 'inset-y-0 left-0 h-full w-[min(22rem,88%)] data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left',
} as const;

export interface DialogContentProps extends Omit<ComponentProps<typeof D.Content>, 'title'> {
  title: ReactNode;
  /** Visually hidden title (still announced). */
  hideTitle?: boolean;
  description?: ReactNode;
  /** `center` = modal dialog; `bottom` = bottom sheet (center from md up); `left` / `right` = drawer (Sheet). */
  side?: keyof typeof sides | 'sheet';
  closeLabel?: string;
}

/**
 * Modal with focus trap, Esc and backdrop dismiss, scroll lock and a close button.
 * `side="sheet"` is the prototype's modal: bottom sheet on phones, centered from md up.
 */
export function DialogContent({ title, hideTitle, description, side = 'center', closeLabel = uiMessages.common.close, className, children, ...props }: DialogContentProps) {
  const pos = side === 'sheet' ? cn(sides.bottom, 'md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:w-[calc(100%-3rem)] md:max-w-3xl md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg md:data-[state=open]:zoom-in-95') : sides[side];
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-overlay data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <D.Content
        className={cn(
          'fixed z-50 flex flex-col gap-4 overflow-y-auto bg-bg p-5 text-text shadow-card duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 md:p-7',
          pos,
          className,
        )}
        {...(description ? {} : { 'aria-describedby': undefined })}
        {...props}
      >
        <div className="flex items-start justify-between gap-4">
          <D.Title className={cn('font-display text-2xl text-primary', hideTitle && 'sr-only')}>{title}</D.Title>
          <D.Close aria-label={closeLabel} className="-mt-1 -mr-1 ml-auto grid size-9 shrink-0 place-items-center rounded-full bg-surface text-text hover:bg-surface-2">
            <X aria-hidden="true" className="size-5" />
          </D.Close>
        </div>
        {description ? <D.Description className="text-sm text-muted">{description}</D.Description> : null}
        {children}
      </D.Content>
    </D.Portal>
  );
}

/** Drawer aliases: a Sheet is a Dialog that slides in from an edge. */
export const Sheet = Dialog;
export const SheetTrigger = DialogTrigger;
export const SheetClose = DialogClose;
export function SheetContent({ side = 'right', ...props }: Omit<DialogContentProps, 'side'> & { side?: 'left' | 'right' | 'bottom' }) {
  return <DialogContent side={side} {...props} />;
}
