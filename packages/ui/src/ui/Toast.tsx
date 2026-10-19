'use client';

import { Toaster, toast } from 'sonner';

/** Mount once in a root layout: the single ARIA-live toast region. Call `toast('Added to cart')` anywhere on the client. */
export function ToastRegion({ label }: { label?: string }) {
  return (
    <Toaster
      position="bottom-center"
      containerAriaLabel={label}
      toastOptions={{
        classNames: {
          toast: '!rounded-md !border-border !bg-primary-strong !text-primary-fg !font-body !shadow-card',
          actionButton: '!bg-accent !text-accent-fg !font-semibold',
          description: '!text-primary-fg/80',
        },
      }}
    />
  );
}

export { toast };
