import { ForbiddenError, requirePermission } from '@ecomkit/core/auth-context';
import { Button, Checkbox, DataTable, FormField, Input, Select, Textarea, type Column } from '@ecomkit/ui';
import { parseTableParams } from '@ecomkit/ui/domain';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { DESCRIPTION_MAX, TITLE_MAX } from '../domain';
import type { SeoNotFound, SeoPageMeta, SeoRedirect } from '../schema';
import { getPageMeta, listNotFound, listPageMeta, listRedirects } from '../server';
import { addRedirectForm, deletePageMetaForm, dismissNotFoundForm, fixNotFoundForm, removeRedirectForm, savePageMetaForm } from './actions';

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const PAGE_SIZE = 50;

/** Admin pages answer 404 to anyone without the permission (no hint that the page exists). */
export async function staffOrNotFound(): Promise<void> {
  try {
    await requirePermission('content.write');
  } catch (err) {
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }
}

const ERRORS: Record<string, string> = {
  'to-loop': 'That redirect would loop back to where it started.',
  'to-same': 'The old and new paths are the same.',
  'to-invalid': 'Paths must start with / and contain no spaces.',
  forbidden: 'You do not have permission to change SEO settings.',
  invalid: 'Some fields are not valid.',
};

function Shell({ title, active, sp, children }: { title: string; active: 'redirects' | 'not-found' | 'page-meta'; sp: Record<string, unknown>; children: ReactNode }) {
  const tabs = [
    ['redirects', 'Redirects', '/admin/seo'],
    ['not-found', '404 log', '/admin/seo/not-found'],
    ['page-meta', 'Page meta', '/admin/seo/page-meta'],
  ] as const;
  const error = typeof sp.error === 'string' ? (ERRORS[sp.error] ?? ERRORS.invalid) : null;
  return (
    <div className="flex flex-col gap-5 p-6">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <nav aria-label="SEO sections" className="flex gap-2 border-b border-border">
        {tabs.map(([id, label, href]) => (
          <Link key={id} href={href} aria-current={id === active ? 'page' : undefined} className={`-mb-px border-b-2 px-3 py-2 text-sm ${id === active ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted hover:text-text'}`}>
            {label}
          </Link>
        ))}
      </nav>
      {error ? (
        <p role="alert" className="rounded-md border border-danger bg-surface px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : sp.saved ? (
        <p role="status" className="rounded-md border border-success bg-surface px-3 py-2 text-sm text-success">
          Saved.
        </p>
      ) : null}
      {children}
    </div>
  );
}

const fmt = (d: Date | null) => (d ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(d) : 'Never');

/** /admin/seo: redirects list, add form, delete. */
export async function RedirectsPage({ searchParams }: PageProps) {
  await staffOrNotFound();
  const sp = await searchParams;
  const params = parseTableParams(sp, {
    filters: { source: ['manual', 'slug_change', 'legacy_import', 'not_found_fix'] },
    sorts: ['from', 'hits', 'created'],
    defaultSort: { id: 'created', dir: 'desc' },
  });
  const { rows, total } = await listRedirects({
    q: params.q,
    source: (params.filters.source as SeoRedirect['source']) ?? null,
    sort: params.sort as 'from' | 'hits' | 'created',
    dir: params.dir,
    page: params.page,
    pageSize: PAGE_SIZE,
  });
  const columns: Column<SeoRedirect>[] = [
    { id: 'from', header: 'Old path', sortable: true, cell: (r) => <code className="text-sm">{r.fromPath}</code> },
    { id: 'to', header: 'Goes to', cell: (r) => <code className="text-sm">{r.toPath}</code> },
    { id: 'status', header: 'Code', cell: (r) => r.statusCode },
    { id: 'source', header: 'Source', cell: (r) => r.source.replace(/_/g, ' ') },
    { id: 'hits', header: 'Hits', sortable: true, align: 'right', cell: (r) => r.hits },
    { id: 'last', header: 'Last hit', cell: (r) => fmt(r.lastHitAt) },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      cell: (r) => (
        <form action={removeRedirectForm}>
          <input type="hidden" name="id" value={r.id} />
          <Button type="submit" variant="ghost" size="sm" aria-label={`Delete redirect from ${r.fromPath}`}>
            Delete
          </Button>
        </form>
      ),
    },
  ];
  return (
    <Shell title="Redirects" active="redirects" sp={sp}>
      <form action={addRedirectForm} className="grid gap-3 rounded-lg border border-border bg-surface p-4 md:grid-cols-[1fr_1fr_8rem_auto] md:items-end">
        <FormField id="from" label="Old path" help="For example /product/old-name" required>
          {(c) => <Input {...c} name="from" required />}
        </FormField>
        <FormField id="to" label="New path" required>
          {(c) => <Input {...c} name="to" required />}
        </FormField>
        <FormField id="statusCode" label="Type">
          {(c) => (
            <Select {...c} name="statusCode" defaultValue="301">
              <option value="301">301 permanent</option>
              <option value="302">302 temporary</option>
            </Select>
          )}
        </FormField>
        <Button type="submit">Add redirect</Button>
      </form>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        params={params}
        total={total}
        pageSize={PAGE_SIZE}
        basePath="/admin/seo"
        filters={[{ key: 'source', label: 'Source', options: ['manual', 'slug_change', 'legacy_import', 'not_found_fix'].map((v) => ({ value: v, label: v.replace(/_/g, ' ') })) }]}
      />
    </Shell>
  );
}

/** /admin/seo/not-found: 404 log by hits, one-click redirect, dismiss. */
export async function NotFoundLogPage({ searchParams }: PageProps) {
  await staffOrNotFound();
  const sp = await searchParams;
  const params = parseTableParams(sp, { filters: { state: ['open', 'fixed'] } });
  const state = params.filters.state ?? 'open';
  const { rows, total } = await listNotFound({ q: params.q, fixed: state === 'fixed', page: params.page, pageSize: PAGE_SIZE });
  const columns: Column<SeoNotFound>[] = [
    { id: 'path', header: 'Path', cell: (r) => <code className="text-sm">{r.path}</code> },
    { id: 'hits', header: 'Hits', align: 'right', cell: (r) => r.hits },
    { id: 'last', header: 'Last seen', cell: (r) => fmt(r.lastAt) },
    { id: 'refs', header: 'Referrers', cell: (r) => <span className="text-xs text-muted">{r.referrers.slice(0, 3).join(', ') || 'None'}</span> },
    {
      id: 'fix',
      header: 'Fix',
      cell: (r) =>
        r.fixedRedirectId ? (
          <span className="text-sm text-success">Redirected</span>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <form action={fixNotFoundForm} className="flex gap-2">
              <input type="hidden" name="path" value={r.path} />
              <label className="sr-only" htmlFor={`to-${r.path}`}>{`Redirect ${r.path} to`}</label>
              <Input id={`to-${r.path}`} name="to" placeholder="/new-path" required className="h-9 w-48 py-1" />
              <Button type="submit" size="sm">
                Redirect
              </Button>
            </form>
            <form action={dismissNotFoundForm}>
              <input type="hidden" name="path" value={r.path} />
              <Button type="submit" variant="ghost" size="sm">
                Dismiss
              </Button>
            </form>
          </div>
        ),
    },
  ];
  return (
    <Shell title="404 log" active="not-found" sp={sp}>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.path}
        params={params}
        total={total}
        pageSize={PAGE_SIZE}
        basePath="/admin/seo/not-found"
        filters={[{ key: 'state', label: 'State', options: [{ value: 'open', label: 'Open' }, { value: 'fixed', label: 'Redirected' }] }]}
      />
    </Shell>
  );
}

function PageMetaForm({ row, back }: { row: Partial<SeoPageMeta> | null; back: string }) {
  return (
    <form action={savePageMetaForm} className="grid gap-3 rounded-lg border border-border bg-surface p-4 md:grid-cols-2">
      <input type="hidden" name="back" value={back} />
      <FormField id="pm-path" label="Path" help="The page this applies to, e.g. /about" required>
        {(c) => <Input {...c} name="path" defaultValue={row?.path ?? ''} required readOnly={Boolean(row?.path)} />}
      </FormField>
      <FormField id="pm-canonical" label="Canonical path" help="Leave empty to use the page's own path">
        {(c) => <Input {...c} name="canonical" defaultValue={row?.canonical ?? ''} />}
      </FormField>
      <FormField id="pm-title" label="Title" help={`About ${TITLE_MAX} characters show in search results`}>
        {(c) => <Input {...c} name="title" maxLength={200} defaultValue={row?.title ?? ''} />}
      </FormField>
      <FormField id="pm-og" label="Social image (media id)">
        {(c) => <Input {...c} name="ogMediaId" defaultValue={row?.ogMediaId ?? ''} />}
      </FormField>
      <FormField id="pm-description" label="Description" help={`About ${DESCRIPTION_MAX} characters show in search results`} className="md:col-span-2">
        {(c) => <Textarea {...c} name="description" maxLength={500} defaultValue={row?.description ?? ''} />}
      </FormField>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox name="noindex" defaultChecked={row?.noindex ?? false} />
        Hide from search engines (noindex) and the sitemap
      </label>
      <div className="flex justify-end">
        <Button type="submit">Save page meta</Button>
      </div>
    </form>
  );
}

/** /admin/seo/page-meta: overrides for hand-written pages. `?path=` opens one for editing. */
export async function PageMetaPage({ searchParams }: PageProps) {
  await staffOrNotFound();
  const sp = await searchParams;
  const params = parseTableParams(sp);
  const editing = typeof sp.path === 'string' ? await getPageMeta(sp.path) : null;
  const { rows, total } = await listPageMeta({ q: params.q, page: params.page, pageSize: PAGE_SIZE });
  const columns: Column<SeoPageMeta>[] = [
    { id: 'path', header: 'Path', cell: (r) => <Link className="text-primary underline" href={`/admin/seo/page-meta?path=${encodeURIComponent(r.path)}`}>{r.path}</Link> },
    { id: 'title', header: 'Title', cell: (r) => r.title ?? 'Default' },
    { id: 'noindex', header: 'Indexing', cell: (r) => (r.noindex ? 'Hidden' : 'Indexed') },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      cell: (r) => (
        <form action={deletePageMetaForm}>
          <input type="hidden" name="path" value={r.path} />
          <Button type="submit" variant="ghost" size="sm" aria-label={`Remove override for ${r.path}`}>
            Remove
          </Button>
        </form>
      ),
    },
  ];
  return (
    <Shell title="Page meta" active="page-meta" sp={sp}>
      <PageMetaForm row={editing} back="/admin/seo/page-meta" />
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.path} params={params} total={total} pageSize={PAGE_SIZE} basePath="/admin/seo/page-meta" />
    </Shell>
  );
}
