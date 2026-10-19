import { requirePermission } from '@ecomkit/core/auth-context';
import { Badge, Button, Checkbox, DataTable, FormField, ImageWithFallback, Input, Select, Skeleton, type Column } from '@ecomkit/ui';
import { parseTableParams, type SearchParamsInput } from '@ecomkit/ui/domain';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { MEDIA_SOURCES } from '../domain';
import { mediaMessages, type MediaErrorCode } from '../messages';
import { listAssets, toImageRef } from '../server/assets';

const PAGE_SIZE = 30;
const spec = {
  filters: { kind: ['image', 'document'], source: MEDIA_SOURCES, credit: ['missing', 'unknown'] },
  sorts: ['created', 'name', 'bytes'],
  defaultSort: { id: 'created', dir: 'desc' as const },
};

type Row = Awaited<ReturnType<typeof listAssets>>['rows'][number];

const kb = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const columns: Column<Row>[] = [
  {
    id: 'preview',
    header: <span className="sr-only">Preview</span>,
    cell: ({ asset }) => {
      const image = toImageRef(asset);
      return image ? (
        <ImageWithFallback image={image} alt="" sizes="56px" className="size-14 rounded-sm object-cover" />
      ) : (
        <span className="grid size-14 place-items-center rounded-sm bg-surface-2 text-xs font-semibold text-muted uppercase">
          {asset.mime.split('/')[1]}
        </span>
      );
    },
  },
  {
    id: 'name',
    header: 'File',
    sortable: true,
    cell: ({ asset }) => (
      <Link href={`/admin/media/${asset.id}`} className="font-semibold text-primary hover:underline">
        {asset.originalName}
        {asset.alt ? <span className="block text-xs font-normal text-muted">{asset.alt}</span> : null}
      </Link>
    ),
  },
  { id: 'source', header: 'Source', cell: ({ asset }) => asset.source.replace('_', ' ') },
  {
    id: 'licence',
    header: 'Licence / credit',
    cell: ({ asset }) => (
      <span className="flex flex-wrap gap-1">
        {asset.licence ? <Badge tone="neutral">{asset.licence}</Badge> : <Badge tone="warning">Licence unknown</Badge>}
        {asset.creditRequired ? <Badge tone={asset.author ? 'outline' : 'danger'}>{asset.author ? 'Credit shown' : 'Credit missing'}</Badge> : null}
      </span>
    ),
  },
  {
    id: 'status',
    header: 'Status',
    cell: ({ asset }) => (
      <span className="flex flex-wrap gap-1">
        <Badge tone={asset.status === 'ready' ? 'success' : asset.status === 'failed' ? 'danger' : 'warning'}>{asset.status}</Badge>
        {asset.isPrivate ? <Badge tone="outline">private</Badge> : null}
      </span>
    ),
  },
  { id: 'usages', header: 'Used by', align: 'right', cell: (r) => r.usages },
  { id: 'bytes', header: 'Size', sortable: true, align: 'right', cell: ({ asset }) => kb(asset.bytes) },
];

function UploadForm() {
  return (
    <form action="/api/media/upload" method="post" encType="multipart/form-data" className="grid gap-3 rounded-lg border border-border bg-surface p-4 md:grid-cols-3">
      <FormField id="media-file" label="File" required help="JPEG, PNG, WebP, AVIF, GIF or PDF, up to 12 MB. SVG is not accepted.">
        {(p) => <Input {...p} name="file" type="file" required accept="image/jpeg,image/png,image/webp,image/avif,image/gif,application/pdf" />}
      </FormField>
      <FormField id="media-alt" label="Alt text" help="What the image shows, for screen readers and search.">
        {(p) => <Input {...p} name="alt" maxLength={250} />}
      </FormField>
      <FormField id="media-source" label="Source">
        {(p) => (
          <Select {...p} name="source" defaultValue="upload">
            {MEDIA_SOURCES.map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ')}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <FormField id="media-licence" label="Licence" help="e.g. Own photo, CC BY 4.0, CC BY-SA 4.0, Public domain">
        {(p) => <Input {...p} name="licence" maxLength={120} />}
      </FormField>
      <FormField id="media-author" label="Author">
        {(p) => <Input {...p} name="author" maxLength={200} />}
      </FormField>
      <FormField id="media-source-url" label="Source URL">
        {(p) => <Input {...p} name="sourceUrl" type="url" maxLength={1000} />}
      </FormField>
      <div className="flex flex-wrap items-center gap-4 md:col-span-3">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox name="creditRequired" /> Licence requires a visible credit
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox name="private" /> Private (signed links only; PDFs are always private)
        </label>
        <Button type="submit" size="sm" className="ml-auto" data-cta="media-upload">
          Upload
        </Button>
      </div>
    </form>
  );
}

async function Library({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  await connection(); // per request: never prerendered at build
  await requirePermission('media.write');
  const raw = await searchParams;
  const params = parseTableParams(raw, spec);
  const f = params.filters;
  const { rows, total } = await listAssets({
    q: params.q,
    kind: f.kind as 'image' | 'document' | undefined,
    source: f.source as (typeof MEDIA_SOURCES)[number] | undefined,
    credit: f.credit as 'missing' | 'unknown' | undefined,
    sort: (params.sort ?? 'created') as 'created' | 'name' | 'bytes',
    dir: params.dir,
    page: params.page,
    pageSize: PAGE_SIZE,
  });
  const error = typeof raw === 'object' && !(raw instanceof URLSearchParams) ? raw.error : undefined;
  const errorText = typeof error === 'string' && error in mediaMessages.errors ? mediaMessages.errors[error as MediaErrorCode] : null;
  return (
    <>
      {errorText ? (
        <p role="alert" className="rounded-sm border border-danger bg-danger/10 px-3 py-2 text-sm text-danger">
          {errorText}
        </p>
      ) : null}
      <UploadForm />
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.asset.id}
        params={params}
        total={total}
        pageSize={PAGE_SIZE}
        basePath="/admin/media"
        filters={[
          { key: 'kind', label: 'Kind', options: [{ value: 'image', label: 'Images' }, { value: 'document', label: 'Documents' }] },
          { key: 'source', label: 'Source', options: MEDIA_SOURCES.map((s) => ({ value: s, label: s.replace('_', ' ') })) },
          { key: 'credit', label: 'Licence', options: [{ value: 'missing', label: 'Credit missing' }, { value: 'unknown', label: 'Licence unknown' }] },
        ]}
      />
    </>
  );
}

/** /admin/media: upload (works without JS) and the library with licence and credit status. */
export function LibraryPage(props: { searchParams: Promise<SearchParamsInput> }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl">Media library</h1>
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <Library {...props} />
      </Suspense>
    </div>
  );
}
