import { cn } from '@ecomkit/ui';
import Link from 'next/link';
import { bellCounts } from '../server/alerts';

/** In-admin bell for the top bar: count of open (not acked) alerts, red when any is critical. */
export async function AlertBell({ className }: { className?: string }) {
  const bell = await bellCounts();
  const open = bell.open.critical + bell.open.high + bell.open.low;
  return (
    <Link href="/admin/health/alerts" aria-label={open ? `${open} open alerts` : 'No open alerts'} className={cn('relative grid size-10 place-items-center rounded-full hover:bg-surface-2', className)}>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {open ? (
        <span className={cn('absolute -top-0.5 -right-0.5 min-w-5 rounded-full px-1 text-center text-[11px] leading-5 font-semibold text-primary-fg', bell.open.critical ? 'bg-danger' : 'bg-warning')}>
          {open > 99 ? '99+' : open}
        </span>
      ) : null}
    </Link>
  );
}
