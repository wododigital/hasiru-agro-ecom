import { getViewer } from '@ecomkit/core/auth-context';
import type { Registry } from '@ecomkit/core/manifest';
import { X } from 'lucide-react';
import Link from 'next/link';
import { Skeleton } from '@ecomkit/ui';
import { Suspense, type ReactNode } from 'react';
import { settingsIndex } from '../server/settings';
import { SettingsNavIsland } from './SettingsNavIsland';

/**
 * Shopify-style settings: a full-screen layer over the admin with its own left list (every enabled module's
 * settings plus users, roles and the activity log), content on the right and a close button back to the admin.
 */
async function SettingsLinks({ registry }: { registry: Registry }) {
  const viewer = await getViewer();
  const perms = viewer.kind === 'staff' ? viewer.permissions : [];
  const links = [
    { label: 'General', href: '/admin/settings' },
    ...(perms.includes('settings.read') ? settingsIndex(registry).map((i) => ({ label: i.title, href: i.href })) : []),
    ...(perms.includes('staff.manage') && registry.nav.some((n) => n.href === '/admin/staff')
      ? [
          { label: 'Users and permissions', href: '/admin/staff' },
          { label: 'Roles', href: '/admin/roles' },
        ]
      : []),
    ...(perms.includes('audit.read') && registry.nav.some((n) => n.href === '/admin/audit') ? [{ label: 'Activity log', href: '/admin/audit' }] : []),
  ];
  return <SettingsNavIsland links={links} />;
}

export function SettingsLayout({ registry, children }: { registry: Registry; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg" data-surface="admin">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-4">
        <p className="text-base font-semibold">Settings</p>
        <Link href="/admin" aria-label="Close settings" className="grid size-10 place-items-center rounded-sm hover:bg-surface-2" data-cta="settings-close">
          <X aria-hidden="true" className="size-5" />
        </Link>
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav aria-label="Settings" className="shrink-0 overflow-x-auto border-b border-border bg-surface p-2 md:w-60 md:overflow-y-auto md:border-r md:border-b-0">
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <SettingsLinks registry={registry} />
          </Suspense>
        </nav>
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 lg:px-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
