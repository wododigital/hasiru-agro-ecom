import { ForbiddenError, requirePermission } from '@ecomkit/core/auth-context';
import { Badge, Button, DataTable, EmptyState, FormField, Input, buttonVariants, type Column } from '@ecomkit/ui';
import { parseTableParams } from '@ecomkit/ui/domain';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { BLOCK_FIELDS, ENTITIES, MENU_ITEM_FIELDS, PAGE_FIELDS, TEMPLATES, isEntityKey, pagePath, type EntityKey } from '../domain';
import type { CmsPage } from '../schema';
import { cmsRuntime, entityCounts, getEntity, getMenuForEdit, getPageForEdit, listEntities, listMenus, listPages } from '../server';
import { deleteEntityForm, deleteMenuForm, deletePageForm, saveEntityAction, saveMenuAction, savePageAction } from './actions';
import { FieldInput } from './fields';
import { FormIsland } from './FormIsland';
import { ListEditorIsland } from './ListEditorIsland';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const PAGE_SIZE = 50;

/** Block editor forms, with the "Embedded tool" choices filled from the host's registered components. */
function blockFields(): typeof BLOCK_FIELDS {
  const options = Object.entries(cmsRuntime().components).map(([value, c]) => ({ value, label: c.label }));
  const component = BLOCK_FIELDS.component;
  return { ...BLOCK_FIELDS, component: { ...component, fields: component.fields.map((f) => (f.name === 'key' ? { ...f, options } : f)) } };
}

/** Content admin answers 404 to anyone without content.write. */
export async function contentStaffOrNotFound(): Promise<void> {
  try {
    await requirePermission('content.write');
  } catch (err) {
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }
}

function Shell({ title, back, actions, sp, children }: { title: string; back?: { href: string; label: string }; actions?: ReactNode; sp?: Record<string, unknown>; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-5 p-6">
      {back ? (
        <Link href={back.href} className="text-sm text-muted hover:underline">
          {`← ${back.label}`}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {actions}
      </div>
      {sp?.saved ? (
        <p role="status" className="rounded-md border border-success bg-surface px-3 py-2 text-sm text-success">
          Saved.
        </p>
      ) : sp?.deleted ? (
        <p role="status" className="rounded-md border border-border bg-surface px-3 py-2 text-sm">
          Deleted.
        </p>
      ) : sp?.error ? (
        <p role="alert" className="rounded-md border border-danger bg-surface px-3 py-2 text-sm text-danger">
          That did not work. Check your permissions and try again.
        </p>
      ) : null}
      {children}
    </div>
  );
}

const status = (s: string) => <Badge tone={s === 'published' ? 'success' : 'neutral'}>{s === 'published' ? 'Published' : 'Draft'}</Badge>;

/** /admin/content: one card per content type with counts. */
export async function ContentHubPage() {
  await contentStaffOrNotFound();
  const counts = await entityCounts();
  const { total: pages } = await listPages({ pageSize: 1 });
  const cards: { href: string; label: string; count: number | null }[] = [
    { href: '/admin/content/pages', label: 'Pages', count: pages },
    { href: '/admin/content/pages?template=policy', label: 'Policies', count: null },
    { href: '/admin/content/menus', label: 'Menus', count: null },
    ...(Object.keys(ENTITIES) as EntityKey[]).map((k) => ({ href: `/admin/content/${k}`, label: ENTITIES[k].plural, count: counts[k] })),
  ];
  return (
    <Shell title="Content">
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <li key={c.href}>
            <Link href={c.href} className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4 hover:border-primary">
              <span className="font-semibold">{c.label}</span>
              {c.count != null ? <span className="text-sm text-muted">{`${c.count} ${c.count === 1 ? 'entry' : 'entries'}`}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </Shell>
  );
}

/** /admin/content/pages (`?template=policy` is the Policies view). */
export async function PagesListPage({ searchParams }: { searchParams: SearchParams }) {
  await contentStaffOrNotFound();
  const sp = await searchParams;
  const params = parseTableParams(sp, { filters: { template: TEMPLATES, status: ['draft', 'published'] } });
  const { rows, total } = await listPages({
    q: params.q,
    template: (params.filters.template as CmsPage['template']) ?? null,
    status: (params.filters.status as CmsPage['status']) ?? null,
    page: params.page,
    pageSize: PAGE_SIZE,
  });
  const columns: Column<CmsPage>[] = [
    { id: 'title', header: 'Title', cell: (r) => <Link className="font-medium text-primary hover:underline" href={`/admin/content/pages/${r.id}`}>{r.title}</Link> },
    { id: 'path', header: 'Address', cell: (r) => <code className="text-sm">{pagePath(r.slug)}</code> },
    { id: 'template', header: 'Template', cell: (r) => r.template },
    { id: 'status', header: 'Status', cell: (r) => status(r.status) },
    { id: 'indexing', header: 'Search', cell: (r) => (r.noindex ? 'Hidden' : 'Indexed') },
  ];
  return (
    <Shell
      title={params.filters.template === 'policy' ? 'Policies' : 'Pages'}
      sp={sp}
      actions={
        <Link href="/admin/content/pages/new" className={buttonVariants({ size: 'sm' })}>
          New page
        </Link>
      }
    >
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        params={params}
        total={total}
        pageSize={PAGE_SIZE}
        basePath="/admin/content/pages"
        filters={[
          { key: 'template', label: 'Template', options: TEMPLATES.map((t) => ({ value: t, label: t })) },
          { key: 'status', label: 'Status', options: [{ value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }] },
        ]}
        empty={<EmptyState title="No pages yet" />}
      />
    </Shell>
  );
}

/** /admin/content/pages/[id] (`new` creates): fields plus the block editor. */
export async function PageEditPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await contentStaffOrNotFound();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const data = id === 'new' ? null : await getPageForEdit(id);
  if (id !== 'new' && !data) notFound();
  const page = data?.page;
  return (
    <Shell
      title={page ? page.title : 'New page'}
      back={{ href: '/admin/content/pages', label: 'Pages' }}
      sp={sp}
      actions={
        page && page.status === 'published' ? (
          <Link href={pagePath(page.slug)} className={buttonVariants({ variant: 'outline', size: 'sm' })} target="_blank">
            View page
          </Link>
        ) : null
      }
    >
      <FormIsland action={savePageAction} submitLabel="Save page">
        <input type="hidden" name="id" value={page?.id ?? ''} />
        <div className="grid gap-4 rounded-lg border border-border bg-surface p-4 md:grid-cols-2">
          {PAGE_FIELDS.map((f) => (
            <FieldInput key={f.name} field={f} value={page ? (page as Record<string, unknown>)[f.name] : f.name === 'template' ? 'default' : f.name === 'status' ? 'draft' : null} />
          ))}
        </div>
        <h2 className="text-lg font-semibold">Blocks</h2>
        <ListEditorIsland name="blocks" types={blockFields()} initial={(data?.blocks ?? []).map((b) => ({ type: b.type, data: b.data as Record<string, unknown> }))} addLabel="Add block" />
      </FormIsland>
      {page ? (
        <form action={deletePageForm} className="self-start">
          <input type="hidden" name="id" value={page.id} />
          <Button type="submit" variant="danger" size="sm">
            Delete page
          </Button>
        </form>
      ) : null}
    </Shell>
  );
}

/** /admin/content/menus: menus by key, and a form to start a new one. */
export async function MenusListPage({ searchParams }: { searchParams: SearchParams }) {
  await contentStaffOrNotFound();
  const sp = await searchParams;
  const menus = await listMenus();
  return (
    <Shell title="Menus" sp={sp}>
      {menus.length ? (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
          {menus.map((m) => (
            <li key={m.key} className="flex items-center justify-between gap-3 px-4 py-3">
              <Link href={`/admin/content/menus/${m.key}`} className="font-medium text-primary hover:underline">
                {m.label || m.key}
              </Link>
              <span className="text-sm text-muted">{`${m.key} · ${m.items} links`}</span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No menus yet" body="Create one, e.g. footer or header." />
      )}
      <form action="/admin/content/menus/new" method="get" className="flex items-end gap-2">
        <FormField id="menu-key" label="New menu key" help="Lowercase, e.g. footer-shop">
          {(c) => <Input {...c} name="key" required pattern="[a-z0-9]+(-[a-z0-9]+)*" />}
        </FormField>
        <Button type="submit" size="sm">
          Create
        </Button>
      </form>
    </Shell>
  );
}

/** /admin/content/menus/[key] (`new?key=` starts one). */
export async function MenuEditPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: SearchParams }) {
  await contentStaffOrNotFound();
  const [{ key: rawKey }, sp] = await Promise.all([params, searchParams]);
  const key = rawKey === 'new' ? String(sp.key ?? '') : rawKey;
  const menu = rawKey === 'new' ? null : await getMenuForEdit(key);
  if (rawKey !== 'new' && !menu) notFound();
  return (
    <Shell title={menu?.label || key || 'New menu'} back={{ href: '/admin/content/menus', label: 'Menus' }} sp={sp}>
      <FormIsland action={saveMenuAction} submitLabel="Save menu">
        <div className="grid gap-4 rounded-lg border border-border bg-surface p-4 md:grid-cols-2">
          <FieldInput field={{ name: 'key', label: 'Key', kind: 'text', required: true }} value={key} />
          <FieldInput field={{ name: 'label', label: 'Name', kind: 'text' }} value={menu?.label ?? ''} />
        </div>
        <ListEditorIsland name="items" types={{ link: { label: 'Link', fields: MENU_ITEM_FIELDS } }} rowsHaveType={false} initial={menu?.items ?? []} addLabel="Add link" />
      </FormIsland>
      {menu ? (
        <form action={deleteMenuForm} className="self-start">
          <input type="hidden" name="key" value={menu.key} />
          <Button type="submit" variant="danger" size="sm">
            Delete menu
          </Button>
        </form>
      ) : null}
    </Shell>
  );
}

const cellText = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v == null || v === '' ? '' : String(v));

/** /admin/content/[entity]: list of one simple content type. */
export async function EntityListPage({ params, searchParams }: { params: Promise<{ entity: string }>; searchParams: SearchParams }) {
  await contentStaffOrNotFound();
  const [{ entity }, sp] = await Promise.all([params, searchParams]);
  if (!isEntityKey(entity)) notFound();
  const def = ENTITIES[entity];
  const tableParams = parseTableParams(sp);
  const { rows, total } = await listEntities(entity, { q: tableParams.q, page: tableParams.page, pageSize: PAGE_SIZE });
  const idOf = (r: Record<string, unknown>) => String(def.idKind === 'key' ? r.key : r.id);
  const labelOf = (name: string) => def.fields.find((f) => f.name === name)?.label ?? name;
  const columns: Column<Record<string, unknown>>[] = def.columns.map((c, i) => ({
    id: c,
    header: labelOf(c),
    cell: (r) =>
      i === 0 ? (
        <Link className="font-medium text-primary hover:underline" href={`/admin/content/${entity}/${encodeURIComponent(idOf(r))}`}>
          {cellText(r[c]) || '(untitled)'}
        </Link>
      ) : c === 'status' ? (
        status(String(r[c]))
      ) : (
        cellText(r[c])
      ),
  }));
  return (
    <Shell
      title={def.plural}
      sp={sp}
      actions={
        <Link href={`/admin/content/${entity}/new`} className={buttonVariants({ size: 'sm' })}>
          {`New ${def.label.toLowerCase()}`}
        </Link>
      }
    >
      <DataTable columns={columns} rows={rows} rowKey={idOf} params={tableParams} total={total} pageSize={PAGE_SIZE} basePath={`/admin/content/${entity}`} empty={<EmptyState title={`No ${def.plural.toLowerCase()} yet`} />} />
    </Shell>
  );
}

/** /admin/content/[entity]/[id] (`new` creates). */
export async function EntityEditPage({ params, searchParams }: { params: Promise<{ entity: string; id: string }>; searchParams: SearchParams }) {
  await contentStaffOrNotFound();
  const [{ entity, id: rawId }, sp] = await Promise.all([params, searchParams]);
  if (!isEntityKey(entity)) notFound();
  const def = ENTITIES[entity];
  const id = decodeURIComponent(rawId);
  const row = id === 'new' ? null : await getEntity(entity, id);
  if (id !== 'new' && !row) notFound();
  const title = row ? cellText(row[def.columns[0]!]) || def.label : `New ${def.label.toLowerCase()}`;
  return (
    <Shell title={title} back={{ href: `/admin/content/${entity}`, label: def.plural }} sp={sp}>
      <FormIsland action={saveEntityAction}>
        <input type="hidden" name="_entity" value={entity} />
        <input type="hidden" name="_id" value={row ? id : ''} />
        <div className="grid gap-4 rounded-lg border border-border bg-surface p-4 md:grid-cols-2">
          {def.fields.map((f) =>
            def.idKind === 'key' && f.name === 'key' && row ? (
              <div key="key" className="flex flex-col gap-1.5">
                <span className="text-sm font-semibold text-primary">{f.label}</span>
                <code className="text-sm">{id}</code>
                <input type="hidden" name="key" value={id} />
              </div>
            ) : (
              <FieldInput key={f.name} field={f} value={row ? row[f.name] : f.name === 'status' ? 'draft' : null} />
            ),
          )}
        </div>
      </FormIsland>
      {row ? (
        <form action={deleteEntityForm} className="self-start">
          <input type="hidden" name="_entity" value={entity} />
          <input type="hidden" name="_id" value={id} />
          <Button type="submit" variant="danger" size="sm">
            Delete
          </Button>
        </form>
      ) : null}
    </Shell>
  );
}
