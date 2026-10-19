import { requirePermission } from '@ecomkit/core/auth-context';
import { Badge, Button, Checkbox, FormField, ImageWithFallback, Input, Select, Skeleton, TBody, THead, Table, Td, Th, Tr, Textarea } from '@ecomkit/ui';
import Link from 'next/link';
import { connection } from 'next/server';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { MEDIA_SOURCES, mediaSrc, shareKey, baseOf } from '../domain';
import { getAsset, listDerivatives, listUsage, signedUrl, toImageRef } from '../server/assets';
import { deleteAssetAction, regenerateAction, saveAssetAction } from './actions';

const NOTICES: Record<string, string> = {
  saved: 'Saved.',
  regenerated: 'Sizes regenerated.',
  in_use: 'This file is still used. Remove it from those records first.',
  invalid: 'Some details are not valid.',
  forbidden: 'You do not have permission for that.',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function Asset({ params, searchParams }: AssetPageProps) {
  await connection(); // per request: never prerendered at build
  await requirePermission('media.write');
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const asset = await getAsset(id);
  if (!asset) notFound();
  const [derivatives, usages, sp] = await Promise.all([listDerivatives(id), listUsage(id), searchParams]);
  const image = toImageRef(asset);
  const noticeKey = ['saved', 'regenerated'].find((k) => sp[k]) ?? (typeof sp.error === 'string' ? sp.error : null);
  const notice = noticeKey ? (NOTICES[noticeKey] ?? NOTICES.invalid) : null;
  const publicImage = asset.kind === 'image' && !asset.isPrivate;

  return (
    <>
      {notice ? (
        <p role="status" className="rounded-sm border border-border bg-surface-2 px-3 py-2 text-sm">
          {notice}
        </p>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="flex flex-col gap-3">
          {image ? (
            <ImageWithFallback image={image} sizes="(min-width: 1024px) 40vw, 100vw" className="h-auto w-full rounded-lg" />
          ) : (
            <p className="rounded-lg border border-border bg-surface-2 p-6 text-sm">
              {asset.isPrivate ? 'Private file: open it with a signed link that expires after 10 minutes.' : 'No preview.'}
            </p>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">Type</dt>
            <dd>{asset.mime}</dd>
            {asset.width ? (
              <>
                <dt className="text-muted">Size</dt>
                <dd>
                  {asset.width} x {asset.height} px
                </dd>
              </>
            ) : null}
            <dt className="text-muted">Status</dt>
            <dd>
              <Badge tone={asset.status === 'ready' ? 'success' : asset.status === 'failed' ? 'danger' : 'warning'}>{asset.status}</Badge>
            </dd>
            <dt className="text-muted">SHA-256</dt>
            <dd className="truncate font-mono text-xs">{asset.sha256}</dd>
            <dt className="text-muted">Link</dt>
            <dd className="truncate">
              {publicImage ? (
                <a className="text-primary hover:underline" href={mediaSrc(asset.storageKey)}>
                  {mediaSrc(asset.storageKey)}
                </a>
              ) : (
                <a className="text-primary hover:underline" href={signedUrl(asset.id)} target="_blank" rel="noreferrer">
                  Open signed link
                </a>
              )}
            </dd>
            {publicImage && derivatives.some((d) => d.format === 'jpeg') ? (
              <>
                <dt className="text-muted">JPEG</dt>
                <dd className="truncate">
                  <a className="text-primary hover:underline" href={mediaSrc(shareKey(baseOf(asset.storageKey)))}>
                    share.jpg
                  </a>
                </dd>
              </>
            ) : null}
          </dl>
        </div>

        <form action={saveAssetAction} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <input type="hidden" name="id" value={asset.id} />
          <FormField id="alt" label="Alt text" help="Describe what the image shows. Leave empty only for decorative images.">
            {(p) => <Input {...p} name="alt" defaultValue={asset.alt} maxLength={250} />}
          </FormField>
          <FormField id="caption" label="Caption">
            {(p) => <Textarea {...p} name="caption" defaultValue={asset.caption ?? ''} maxLength={500} />}
          </FormField>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField id="source" label="Source">
              {(p) => (
                <Select {...p} name="source" defaultValue={asset.source}>
                  {MEDIA_SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace('_', ' ')}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField id="licence" label="Licence" help="Own photo, CC BY 4.0, CC BY-SA 4.0, Public domain, Stock licence">
              {(p) => <Input {...p} name="licence" defaultValue={asset.licence ?? ''} maxLength={120} />}
            </FormField>
            <FormField id="author" label="Author">
              {(p) => <Input {...p} name="author" defaultValue={asset.author ?? ''} maxLength={200} />}
            </FormField>
            <FormField id="sourceUrl" label="Source URL">
              {(p) => <Input {...p} name="sourceUrl" type="url" defaultValue={asset.sourceUrl ?? ''} maxLength={1000} />}
            </FormField>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox name="creditRequired" defaultChecked={asset.creditRequired} /> Licence requires a visible credit (shown under the image as author, licence)
          </label>
          <Button type="submit" size="sm" className="self-start" data-cta="media-save">
            Save
          </Button>
        </form>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg">Used by ({usages.length})</h2>
        {usages.length ? (
          <ul className="list-disc pl-5 text-sm">
            {usages.map((u) => (
              <li key={`${u.entity}:${u.entityId}`}>
                {u.entity} <span className="font-mono text-xs">{u.entityId}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Not used anywhere.</p>
        )}
      </section>

      {publicImage ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg">Generated sizes ({derivatives.length})</h2>
          <Table>
            <THead>
              <tr>
                <Th>Format</Th>
                <Th className="text-right">Width</Th>
                <Th className="text-right">Bytes</Th>
              </tr>
            </THead>
            <TBody>
              {derivatives.map((d) => (
                <Tr key={`${d.format}-${d.width}`}>
                  <Td>{d.format}</Td>
                  <Td className="text-right">{d.width}</Td>
                  <Td className="text-right">{d.bytes.toLocaleString('en-IN')}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <form action={regenerateAction}>
            <input type="hidden" name="id" value={asset.id} />
            <Button type="submit" size="sm" variant="subtle" data-cta="media-regenerate">
              Regenerate sizes
            </Button>
          </form>
        </section>
      ) : null}

      <form action={deleteAssetAction} className="border-t border-border pt-4">
        <input type="hidden" name="id" value={asset.id} />
        <Button type="submit" size="sm" variant="danger" disabled={usages.length > 0} data-cta="media-delete">
          Delete file
        </Button>
      </form>
    </>
  );
}

export interface AssetPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** /admin/media/[id]: preview, licence and credit fields, usages, generated sizes, delete when unused. */
export function AssetPage(props: AssetPageProps) {
  return (
    <div className="flex flex-col gap-5">
      <Link href="/admin/media" className="text-sm text-primary hover:underline">
        Back to media library
      </Link>
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <Asset {...props} />
      </Suspense>
    </div>
  );
}
