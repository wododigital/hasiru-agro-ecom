import { getViewer } from '@ecomkit/core/auth-context';
import type { StaffViewer } from '@ecomkit/core/contracts';
import type { Registry } from '@ecomkit/core/manifest';
import { Skeleton, ToastRegion } from '@ecomkit/ui';
import { Bell, CircleDot, icons } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';
import { adminGate, navSections, ROLE_LABELS } from '../domain';
import { requestMeta } from '../server/access';
import { hasSearch, type SearchGroup } from '../server/search';
import { MobileNavIsland, NavList, type NavSectionView } from './NavIsland';
import { SearchIsland } from './SearchIsland';

export interface AdminLayoutProps {
  /** The app's generated registry (nav, settings, widgets and search come from enabled modules only). */
  registry: Registry;
  children: ReactNode;
  /** Server action for the top bar: `(q) => searchAdmin(registry, q)`. Omit to hide search. */
  search?: (query: string) => Promise<SearchGroup[]>;
  /** Extra items in the staff menu, e.g. the auth module's sign-out form. */
  account?: ReactNode;
  /** Sidebar heading (the store's name). */
  title?: string;
}

/** `shopping-cart` -> lucide `ShoppingCart`; unknown names fall back to a dot rather than breaking the nav. */
function NavIcon({ name }: { name: string }) {
  const key = name.replace(/(^|-)([a-z0-9])/g, (_, __, c: string) => c.toUpperCase()) as keyof typeof icons;
  const Icon = icons[key] ?? CircleDot;
  return <Icon aria-hidden="true" />;
}

function ShellSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading admin" className="min-h-dvh bg-bg lg:grid lg:grid-cols-[15rem_1fr]">
      <div className="hidden flex-col gap-2 border-r border-border bg-surface p-4 lg:flex">
        {Array.from({ length: 9 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
      <div className="flex flex-col">
        <div className="flex h-14 items-center gap-3 border-b border-border bg-surface px-4">
          <Skeleton className="h-9 max-w-xl flex-1" />
        </div>
        <div className="flex flex-col gap-4 p-6">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    </div>
  );
}

function StaffMenu({ viewer, account }: { viewer: StaffViewer; account?: ReactNode }) {
  return (
    <details className="relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-surface-2" data-cta="admin-staff-menu">
        <span aria-hidden="true" className="grid size-8 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-fg">
          {viewer.name.charAt(0).toUpperCase() || '?'}
        </span>
        <span className="hidden text-sm font-medium md:inline">{viewer.name}</span>
      </summary>
      <div className="absolute right-0 z-40 mt-1 flex w-64 flex-col gap-2 rounded-md border border-border bg-surface p-3 shadow-card">
        <p className="text-sm font-semibold">{viewer.name}</p>
        <p className="text-xs break-all text-muted">{viewer.email}</p>
        <p className="text-xs text-muted">{ROLE_LABELS[viewer.role]}</p>
        {account}
      </div>
    </details>
  );
}

async function GatedShell({ registry, children, search, account, title = 'Admin' }: AdminLayoutProps) {
  const viewer = await getViewer();
  const gate = adminGate(viewer, (await requestMeta()).pathname);
  if (gate === 'not-found') notFound();
  if (gate === 'bare' || viewer.kind !== 'staff') return children;

  const sections: NavSectionView[] = navSections(registry.nav, viewer.permissions).map((s) => ({
    ...s,
    items: s.items.map((i) => ({ label: i.label, href: i.href, icon: <NavIcon name={i.icon} /> })),
  }));

  return (
    <div className="min-h-dvh bg-bg text-text lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-4 overflow-y-auto border-r border-border bg-surface p-3 lg:flex">
        <Link href="/admin" className="px-3 pt-2 text-base font-semibold text-primary">
          {title}
        </Link>
        <nav aria-label="Admin">
          <NavList sections={sections} />
        </nav>
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-surface px-3 md:px-4">
          <MobileNavIsland sections={sections} title={title} />
          {search && hasSearch(registry, viewer.permissions) ? <SearchIsland search={search} /> : <div className="flex-1" />}
          <div className="ml-auto flex items-center gap-1">
            {registry.has('monitoring') && viewer.permissions.includes('health.read') ? (
              <Link href="/admin/health" aria-label="Alerts and health" className="grid size-10 place-items-center rounded-sm hover:bg-surface-2" data-cta="admin-alerts">
                <Bell aria-hidden="true" className="size-5" />
              </Link>
            ) : null}
            <StaffMenu viewer={viewer} account={account} />
          </div>
        </header>
        <main id="admin-main" className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 lg:px-8">
          {children}
        </main>
      </div>
      <ToastRegion />
    </div>
  );
}

/**
 * The admin frame for every /admin page: sidebar from the registry nav (sorted by order, grouped by band,
 * filtered by the viewer's permissions), top bar with search, alerts and the staff menu.
 * Non-staff get a 404 except on the sign-in page. Everything waits behind one Suspense boundary whose
 * fallback is the shell skeleton, so the static frame streams first.
 */
export function AdminLayout(props: AdminLayoutProps) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <GatedShell {...props} />
    </Suspense>
  );
}
