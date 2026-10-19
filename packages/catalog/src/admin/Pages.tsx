import { requirePermission } from '@ecomkit/core/auth-context';
import { Badge, DataTable, buttonVariants, type Column } from '@ecomkit/ui';
import { parseTableParams, type SearchParamsInput } from '@ecomkit/ui/domain';
import Link from 'next/link';
import * as E from '../domain/enums';
import type { Kind } from '../domain/enums';
import { ADMIN_PAGE_SIZE, dataGaps, listAdminProducts, listCollectionsAdmin, listFaqsAdmin, listTagsAdmin, productOptions, type GapKind } from '../server/admin-queries';
import { deleteCollectionAction, deleteFaqAction, deleteTagAction, importAction, saveCollectionAction, saveFaqAction, saveTagAction } from './actions';
import { ActionFormIsland } from './ActionFormIsland';
import { AreaField, Card, CheckField, Grid, SelectField, TextField } from './fields';

type SP = Promise<SearchParamsInput>;

const PRODUCT_SPEC = {
  filters: { status: E.STATUSES, review: ['needs_review', 'image_needed'] },
  sorts: ['name', 'sku', 'status', 'updated'],
  defaultSort: { id: 'name', dir: 'asc' as const },
};

/** /admin/products (plants) and /admin/inputs. */
export async function ProductsListPage({ kind, searchParams }: { kind: Kind; searchParams: SP }) {
  await requirePermission('products.read');
  const params = parseTableParams(await searchParams, PRODUCT_SPEC);
  const { rows, total } = await listAdminProducts({ kind, q: params.q, status: params.filters.status, review: params.filters.review as 'needs_review' | undefined, sort: params.sort, dir: params.dir, page: params.page });
  type Row = (typeof rows)[number];
  const columns: Column<Row>[] = [
    {
      id: 'name',
      header: 'Name',
      sortable: true,
      cell: (r) => (
        <Link href={`/admin/products/${r.id}`} className="font-semibold text-primary hover:underline">
          {r.name}
        </Link>
      ),
    },
    { id: 'sku', header: 'SKU', sortable: true, cell: (r) => r.sku },
    { id: 'collection', header: 'Collection', cell: (r) => r.collection ?? '-' },
    { id: 'status', header: 'Status', sortable: true, cell: (r) => <Badge tone={r.status === 'active' ? 'success' : 'neutral'}>{r.availabilityOverride ? `${r.status} · ${r.availabilityOverride.replace(/_/g, ' ')}` : r.status}</Badge> },
    {
      id: 'flags',
      header: 'Flags',
      cell: (r) => (
        <span className="flex gap-1">
          {r.needsReview ? <Badge tone="warning">review</Badge> : null}
          {r.imageNeeded ? <Badge tone="warning">photo</Badge> : null}
        </span>
      ),
    },
    { id: 'updated', header: 'Updated', sortable: true, cell: (r) => r.updatedAt.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) },
  ];
  const base = kind === 'input' ? '/admin/inputs' : '/admin/products';
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{kind === 'input' ? 'Inputs' : 'Plants'}</h1>
        <div className="flex gap-2">
          <Link href="/admin/import" className={buttonVariants({ variant: 'outline', size: 'sm' })} data-cta="admin-products-import">
            Import / Export
          </Link>
          <Link href={`/admin/products/new${kind === 'input' ? '?kind=input' : ''}`} className={buttonVariants({ size: 'sm' })} data-cta="admin-products-new">
            {kind === 'input' ? 'Add input' : 'Add plant'}
          </Link>
        </div>
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        params={params}
        total={total}
        pageSize={ADMIN_PAGE_SIZE}
        basePath={base}
        filters={[
          { key: 'status', label: 'Status', options: E.STATUSES.map((s) => ({ value: s, label: s })) },
          { key: 'review', label: 'Needs', options: [{ value: 'needs_review', label: 'Review' }, { value: 'image_needed', label: 'Photo' }] },
        ]}
      />
    </div>
  );
}

/** /admin/collections: tree list with inline edit and a create form. */
export async function CollectionsPage() {
  await requirePermission('products.read');
  const rows = await listCollectionsAdmin();
  const parents = rows.filter((r) => !r.parentId);
  const form = (r: (typeof rows)[number] | null) => (
    <ActionFormIsland action={saveCollectionAction} submitLabel={r ? 'Save' : 'Add collection'} cta={r ? 'admin-collection-save' : 'admin-collection-add'}>
      {r ? <input type="hidden" name="id" value={r.id} /> : null}
      <Grid>
        <TextField name="name" label="Name" value={r?.name} required />
        <TextField name="slug" label="Slug" value={r?.slug} required />
        <TextField name="nameKn" label="Local-language name" value={r?.nameKn} />
        <SelectField name="kind" label="Kind" value={r?.kind ?? 'plant'} options={E.KINDS} blank={false} />
        <SelectField name="parentId" label="Parent" value={r?.parentId} options={parents.filter((x) => x.id !== r?.id).map((x) => ({ value: x.id, label: x.name }))} />
        <TextField name="position" label="Position" value={r?.position ?? 0} type="number" />
        <TextField name="seoTitle" label="SEO title" value={r?.seoTitle} />
        <TextField name="seoDescription" label="SEO description" value={r?.seoDescription} />
      </Grid>
      <AreaField name="introHtml" label="Intro (HTML, shown above the products)" value={r?.introHtml} rows={3} />
      <CheckField name="isIndexable" label="Indexable" checked={r?.isIndexable ?? true} />
    </ActionFormIsland>
  );
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Collections</h1>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.id} className={r.parentId ? 'ml-6' : ''}>
            <details className="rounded-md border border-border bg-surface p-3">
              <summary className="cursor-pointer">
                <span className="font-semibold">{r.name}</span> <span className="text-sm text-muted">/{r.slug} · {r.kind} · {r.products} products</span>
              </summary>
              <div className="flex flex-col gap-3 pt-3">
                {form(r)}
                <ActionFormIsland action={deleteCollectionAction} submitLabel="Delete" variant="danger" cta="admin-collection-delete">
                  <input type="hidden" name="id" value={r.id} />
                </ActionFormIsland>
              </div>
            </details>
          </li>
        ))}
      </ul>
      <Card title="New collection">{form(null)}</Card>
    </div>
  );
}

/** /admin/tags: trait tags get curated pages at /plants/<slug>; use and filter tags feed cards and facets. */
export async function TagsPage() {
  await requirePermission('products.read');
  const rows = await listTagsAdmin();
  const form = (r: (typeof rows)[number] | null) => (
    <ActionFormIsland action={saveTagAction} submitLabel={r ? 'Save' : 'Add tag'} cta={r ? 'admin-tag-save' : 'admin-tag-add'}>
      {r ? <input type="hidden" name="id" value={r.id} /> : null}
      <Grid>
        <TextField name="name" label="Name" value={r?.name} required />
        <TextField name="slug" label="Slug" value={r?.slug} required />
        <TextField name="nameKn" label="Local-language name" value={r?.nameKn} />
        <SelectField name="kind" label="Kind" value={r?.kind ?? 'filter'} options={E.TAG_KINDS} blank={false} />
        <TextField name="position" label="Position" value={r?.position ?? 0} type="number" />
      </Grid>
      <AreaField name="introHtml" label="Curated page intro (HTML, trait tags)" value={r?.introHtml} rows={3} />
      <CheckField name="showOnCard" label="Show on product cards" checked={r?.showOnCard ?? false} />
    </ActionFormIsland>
  );
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Tags</h1>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.id}>
            <details className="rounded-md border border-border bg-surface p-3">
              <summary className="cursor-pointer">
                <span className="font-semibold">{r.name}</span> <span className="text-sm text-muted">{r.kind} · {r.products} products</span>
              </summary>
              <div className="flex flex-col gap-3 pt-3">
                {form(r)}
                <ActionFormIsland action={deleteTagAction} submitLabel="Delete" variant="danger" cta="admin-tag-delete">
                  <input type="hidden" name="id" value={r.id} />
                </ActionFormIsland>
              </div>
            </details>
          </li>
        ))}
      </ul>
      <Card title="New tag">{form(null)}</Card>
    </div>
  );
}

const FAQ_LABEL: Record<string, string> = { answered: 'Answered (not shown)', ai_draft: 'Draft answer', client_only: 'Needs the grower', published: 'Published' };

/** /admin/faqs: only published FAQs with an answer show on product pages (and in FAQPage JSON-LD). */
export async function FaqsPage({ searchParams }: { searchParams: SP }) {
  await requirePermission('products.read');
  const params = parseTableParams(await searchParams, { filters: { status: E.FAQ_STATUSES } });
  const [{ rows, total }, products] = await Promise.all([listFaqsAdmin({ status: params.filters.status, page: params.page }), productOptions()]);
  const form = (r: (typeof rows)[number] | null) => (
    <ActionFormIsland action={saveFaqAction} submitLabel={r ? 'Save' : 'Add FAQ'} cta={r ? 'admin-faq-save' : 'admin-faq-add'}>
      {r ? <input type="hidden" name="id" value={r.id} /> : null}
      <Grid>
        <SelectField name="productId" label="Product (blank = general)" value={r?.productId} options={products.map((p) => ({ value: p.id, label: p.name }))} />
        <SelectField name="status" label="Status" value={r?.status ?? 'answered'} options={E.FAQ_STATUSES.map((s) => ({ value: s, label: FAQ_LABEL[s]! }))} blank={false} />
        <TextField name="position" label="Position" value={r?.position ?? 0} type="number" />
      </Grid>
      <TextField name="question" label="Question" value={r?.question} required />
      <AreaField name="answerHtml" label="Answer (HTML)" value={r?.answerHtml} rows={4} />
      <input type="hidden" name="source" value={r?.source ?? 'admin'} />
    </ActionFormIsland>
  );
  const pages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">FAQs</h1>
      <nav className="flex flex-wrap gap-2 text-sm">
        <Link href="/admin/faqs" className="underline">
          All
        </Link>
        {E.FAQ_STATUSES.map((s) => (
          <Link key={s} href={`/admin/faqs?status=${s}`} className="underline" aria-current={params.filters.status === s ? 'page' : undefined}>
            {FAQ_LABEL[s]}
          </Link>
        ))}
      </nav>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.id}>
            <details className="rounded-md border border-border bg-surface p-3">
              <summary className="cursor-pointer">
                <span className="font-semibold">{r.question}</span> <span className="text-sm text-muted">{r.product ?? 'General'} · {FAQ_LABEL[r.status]}</span>
              </summary>
              <div className="flex flex-col gap-3 pt-3">
                {form(r)}
                <ActionFormIsland action={deleteFaqAction} submitLabel="Delete" variant="danger" cta="admin-faq-delete">
                  <input type="hidden" name="id" value={r.id} />
                </ActionFormIsland>
              </div>
            </details>
          </li>
        ))}
      </ul>
      {pages > 1 ? (
        <p className="text-sm">
          {params.page > 1 ? (
            <Link href={`/admin/faqs?${new URLSearchParams({ ...(params.filters.status ? { status: params.filters.status } : {}), page: String(params.page - 1) })}`} className="underline">
              Previous
            </Link>
          ) : null}{' '}
          Page {params.page} of {pages}{' '}
          {params.page < pages ? (
            <Link href={`/admin/faqs?${new URLSearchParams({ ...(params.filters.status ? { status: params.filters.status } : {}), page: String(params.page + 1) })}`} className="underline">
              Next
            </Link>
          ) : null}
        </p>
      ) : null}
      <Card title="New FAQ">{form(null)}</Card>
    </div>
  );
}

const GAP_LABEL: Record<GapKind, string> = {
  needs_review: 'Needs review',
  image_needed: 'Real photo needed',
  no_collection: 'No collection',
  no_description: 'No description',
  no_local_name: 'No local-language name',
  no_scientific_name: 'No scientific name',
  no_size_class: 'No size class',
  no_climate: 'No climate range',
  no_spacing: 'No model spacing',
  unanswered_faqs: 'FAQs waiting for answers',
};

/** /admin/data-gaps: what is missing per product and the open questions recorded by the importer. */
export async function DataGapsPage() {
  await requirePermission('products.read');
  const rows = await dataGaps();
  const counts = new Map<GapKind, number>();
  for (const r of rows) for (const g of r.gaps) counts.set(g, (counts.get(g) ?? 0) + 1);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Data gaps</h1>
      <ul className="flex flex-wrap gap-2">
        {[...counts.entries()].map(([g, n]) => (
          <li key={g}>
            <Badge tone="warning">
              {GAP_LABEL[g]}: {n}
            </Badge>
          </li>
        ))}
      </ul>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left">
            <th className="py-2">Product</th>
            <th>Status</th>
            <th>Gaps</th>
            <th>Open questions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border align-top">
              <td className="py-2">
                <Link href={`/admin/products/${r.id}`} className="font-semibold text-primary hover:underline">
                  {r.name}
                </Link>
                <span className="block text-xs text-muted">{r.sku}</span>
              </td>
              <td>{r.status}</td>
              <td>{r.gaps.map((g) => GAP_LABEL[g]).join(', ')}</td>
              <td>
                {r.notes.length ? (
                  <ul className="list-disc pl-4">
                    {r.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** /admin/import: upload the grower's "Plant data" sheet or the flat CSV; export both. */
export async function ImportPage() {
  await requirePermission('products.write');
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Import / Export</h1>
      <Card title="Import">
        <p className="text-sm text-muted">
          The plant data sheet (.xlsx, same layout as the export) updates agronomy columns of matching plants by variety and name; unknown rows become drafts marked for
          review. The CSV (.csv, same columns as the export) updates any field by SKU, or by legacy SKU for an older store export.
        </p>
        <ActionFormIsland action={importAction} submitLabel="Import" cta="admin-import-submit">
          <input type="file" name="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required aria-label="File to import" />
        </ActionFormIsland>
      </Card>
      <Card title="Export">
        <div className="flex flex-wrap gap-2">
          <a href="/api/catalog/export?format=xlsx" className={buttonVariants({ variant: 'outline', size: 'sm' })} data-cta="admin-export-sheet">
            Plant data sheet (.xlsx)
          </a>
          <a href="/api/catalog/export?format=csv" className={buttonVariants({ variant: 'outline', size: 'sm' })} data-cta="admin-export-csv">
            All products (.csv)
          </a>
        </div>
      </Card>
    </div>
  );
}
