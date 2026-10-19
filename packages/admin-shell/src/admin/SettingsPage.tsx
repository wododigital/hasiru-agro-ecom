import type { Registry } from '@ecomkit/core/manifest';
import { EmptyState, Skeleton } from '@ecomkit/ui';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { requireAdmin } from '../server/access';
import { loadSettingsView, settingsIndex, type ActionOutcome } from '../server/settings';
import type { FormState } from '../domain';
import type { FormAction } from './ActionFormIsland';
import { NoAccess, PageHeader, PageSkeleton } from './PageHeader';
import { CopyIsland, SettingsActionsIsland, SettingsFormIsland } from './SettingsIsland';

/** /admin/settings: one card per enabled module that declares settings. */
export function SettingsIndexPage(props: { registry: Registry }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SettingsIndex {...props} />
    </Suspense>
  );
}

async function SettingsIndex({ registry }: { registry: Registry }) {
  const access = await requireAdmin('settings.read');
  if (access.state === 'forbidden') return <NoAccess title="Settings" />;
  const items = settingsIndex(registry);
  return (
    <>
      <PageHeader title="Settings" description="Store, payments, delivery, messaging and integrations. Each enabled module adds its own page." />
      {items.length === 0 ? (
        <EmptyState title="No settings yet" body="Modules with settings appear here once they are enabled." />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <li key={item.moduleId}>
              <Link href={item.href} className="flex h-full items-center gap-3 rounded-md border border-border bg-surface p-4 hover:border-primary" data-cta={`settings-open-${item.moduleId}`}>
                <span className="flex flex-1 flex-col gap-1">
                  <span className="font-semibold text-primary">{item.title}</span>
                  <span className="text-xs text-muted">{item.groups.join(' · ')}</span>
                </span>
                <ChevronRight aria-hidden="true" className="size-4 text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export interface SettingsPageProps {
  registry: Registry;
  /** The route params (`/admin/settings/[module]`). */
  params: Promise<{ module: string }>;
  /** Server action: `(moduleId, prev, form) => saveSettings(registry, moduleId, form)`; bound to the module here. */
  save: (moduleId: string, prev: FormState, form: FormData) => Promise<FormState>;
  /** Server action: `(moduleId, actionId) => runSettingsAction(registry, moduleId, actionId)`. */
  runAction: (moduleId: string, actionId: string) => Promise<ActionOutcome>;
}

/**
 * /admin/settings/<module>: rendered entirely from the manifest. Integration card (copyable URLs, action
 * buttons with last status), the generated form, then the module's custom panel. No module owns this route.
 */
export function SettingsPage(props: SettingsPageProps) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SettingsContent {...props} />
    </Suspense>
  );
}

async function SettingsContent({ registry, params, save, runAction }: SettingsPageProps) {
  const { module: moduleId } = await params;
  const access = await requireAdmin('settings.read');
  if (access.state === 'forbidden') return <NoAccess title="Settings" />;
  const view = await loadSettingsView(registry, moduleId, access.viewer);
  if (!view) notFound();
  const { Panel } = view;
  return (
    <>
      <PageHeader title={view.title} crumbs={[{ label: 'Settings', href: '/admin/settings' }]} />
      {view.urls.length || view.actions.length ? (
        <section aria-labelledby="settings-connection" className="flex flex-col gap-4 rounded-md border border-border bg-surface p-4 md:p-5">
          <h2 id="settings-connection" className="text-base font-semibold text-primary">
            Connection
          </h2>
          {view.urls.map((u) => (
            <div key={u.url} className="flex flex-col gap-1">
              <p className="text-sm font-semibold">{u.label}</p>
              <CopyIsland value={u.url} label={u.label} />
              {u.help ? <p className="text-xs text-muted">{u.help}</p> : null}
            </div>
          ))}
          {view.actions.length ? <SettingsActionsIsland actions={view.actions} run={runAction.bind(null, moduleId)} /> : null}
        </section>
      ) : null}
      {view.fields.length ? <SettingsFormIsland fields={view.fields} save={save.bind(null, moduleId) as FormAction} canWrite={view.canWrite} canWriteSecrets={view.canWriteSecrets} /> : null}
      {Panel ? (
        <Suspense fallback={<Skeleton className="h-48 w-full" />}>
          <Panel moduleId={moduleId} />
        </Suspense>
      ) : null}
    </>
  );
}
