import type { ComponentProps } from 'react';
import { cn } from '../cn';

/** Plain semantic table parts. DataTable builds on these; use them directly for small static tables. */
export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <div className="w-full overflow-x-auto rounded-md border border-border bg-surface">
      <table className={cn('w-full border-collapse text-left text-sm', className)} {...props} />
    </div>
  );
}
export const THead = ({ className, ...props }: ComponentProps<'thead'>) => <thead className={cn('bg-surface-2 text-muted', className)} {...props} />;
export const TBody = ({ className, ...props }: ComponentProps<'tbody'>) => <tbody className={cn('divide-y divide-border', className)} {...props} />;
export const Tr = ({ className, ...props }: ComponentProps<'tr'>) => <tr className={cn('hover:bg-surface-2/60', className)} {...props} />;
export const Th = ({ className, ...props }: ComponentProps<'th'>) => <th scope="col" className={cn('px-3 py-2 font-semibold whitespace-nowrap', className)} {...props} />;
export const Td = ({ className, ...props }: ComponentProps<'td'>) => <td className={cn('px-3 py-2 align-middle', className)} {...props} />;
