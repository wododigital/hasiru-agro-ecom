import { Breadcrumbs, EmptyState, Skeleton, type Crumb } from '@ecomkit/ui';
import { ShieldOff } from 'lucide-react';
import type { ReactNode } from 'react';

/** Title row for an admin page: optional breadcrumbs, description and actions on the right. */
export function PageHeader({ title, description, crumbs, actions }: { title: string; description?: ReactNode; crumbs?: readonly Crumb[]; actions?: ReactNode }) {
  return (
    <header className="flex flex-col gap-2">
      {crumbs?.length ? <Breadcrumbs items={[...crumbs, { label: title }]} /> : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-text">{title}</h1>
          {description ? <p className="max-w-2xl text-sm text-muted">{description}</p> : null}
        </div>
        {actions}
      </div>
    </header>
  );
}

/** Staff without the page's permission see this instead of the page (non-staff never get here: 404). */
export function NoAccess({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState icon={<ShieldOff aria-hidden="true" />} title="You do not have access to this page" body="Ask the store owner to change your role if you need it." />
    </>
  );
}

/** Fallback every admin page streams first: it sits inside the page segment, so navigation shows it at once. */
export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-4">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
