// Marketing > Pixels & tags (admin copy is English-only, exempt from messages).
import { Badge, Button, Checkbox, DataTable, FormField, Input, Select, Textarea, type Column } from '@ecomkit/ui';
import { parseTableParams } from '@ecomkit/ui/domain';
import Link from 'next/link';
import { TAG_PLACEMENTS, TAG_SCOPES, TAG_VENDORS } from '../domain/tags';
import type { ConversionEventRow, MarketingTagRow } from '../schema';
import { readPublicTagConfig } from '../server/config';
import { listConversions } from '../server/conversions';
import { getTag, listTags } from '../server/tags';
import { deleteTagAction, saveTagAction } from './actions';

const when = (d: Date) => d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function TagForm({ tag }: { tag: MarketingTagRow | null }) {
  return (
    <form action={saveTagAction} className="grid gap-3 rounded-lg border border-border bg-surface p-4 md:grid-cols-2">
      <h2 className="text-lg font-semibold md:col-span-2">{tag ? `Edit ${tag.name}` : 'Add a custom tag'}</h2>
      {tag && <input type="hidden" name="id" value={tag.id} />}
      <FormField id="tag-name" label="Name" required>
        {(p) => <Input {...p} name="name" defaultValue={tag?.name ?? ''} required maxLength={80} />}
      </FormField>
      <FormField id="tag-vendor" label="Vendor">
        {(p) => (
          <Select {...p} name="vendor" defaultValue={tag?.vendor ?? 'custom'}>
            {TAG_VENDORS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <FormField id="tag-placement" label="Placement">
        {(p) => (
          <Select {...p} name="placement" defaultValue={tag?.placement ?? 'body_end'}>
            {TAG_PLACEMENTS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <FormField id="tag-scope" label="Runs on" help="All pages, or only under the paths below.">
        {(p) => (
          <Select {...p} name="scope" defaultValue={tag?.scope ?? 'all'}>
            {TAG_SCOPES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <FormField id="tag-paths" label="Paths" help="One path prefix per line, e.g. /checkout" className="md:col-span-2">
        {(p) => <Textarea {...p} name="paths" rows={2} defaultValue={tag?.paths.join('\n') ?? ''} />}
      </FormField>
      <FormField id="tag-snippet" label="Snippet" required help="The vendor's HTML. Scripts run when the tag loads (after consent when required)." className="md:col-span-2">
        {(p) => <Textarea {...p} name="snippet" rows={6} required className="font-mono text-xs" defaultValue={tag?.snippet ?? ''} />}
      </FormField>
      <FormField id="tag-csp" label="Allowed hosts" help="Every https origin the snippet loads from or sends to, one per line. Added to the storefront security policy while the tag is active." className="md:col-span-2">
        {(p) => <Textarea {...p} name="cspSources" rows={2} defaultValue={tag?.cspSources.join('\n') ?? ''} />}
      </FormField>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox name="requiresConsent" defaultChecked={tag?.requiresConsent ?? true} /> Load only after advertising consent
      </label>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox name="isActive" defaultChecked={tag?.isActive ?? false} /> Active
      </label>
      <div className="flex gap-2 md:col-span-2">
        <Button type="submit">{tag ? 'Save tag' : 'Add tag'}</Button>
        {tag && (
          <Link className="self-center text-sm text-primary underline" href="/admin/marketing/tags">
            Cancel
          </Link>
        )}
      </div>
    </form>
  );
}

export async function TagsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const params = parseTableParams(searchParams);
  const editId = one(searchParams.edit);
  const [rows, config, conversions, editing] = await Promise.all([listTags(), readPublicTagConfig(), listConversions({ pageSize: 25 }), editId ? getTag(editId) : Promise.resolve(null)]);
  const error = one(searchParams.error);

  const builtIn = [
    { name: 'Google Analytics 4', id: config.ga4, consent: 'Analytics' },
    { name: 'Meta Pixel + Conversions API', id: config.metaPixel, consent: 'Advertising' },
    { name: 'Google Ads conversion', id: config.ads ? `${config.ads.id}${config.ads.purchaseLabel ? ` / ${config.ads.purchaseLabel}` : ''}` : null, consent: 'Advertising' },
  ];
  const tagColumns: Column<MarketingTagRow>[] = [
    { id: 'name', header: 'Name', cell: (r) => <Link className="text-primary underline" href={`/admin/marketing/tags?edit=${r.id}`}>{r.name}</Link> },
    { id: 'vendor', header: 'Vendor', cell: (r) => r.vendor },
    { id: 'scope', header: 'Runs on', cell: (r) => (r.scope === 'all' ? 'All pages' : r.paths.join(', ')) },
    { id: 'consent', header: 'Consent', cell: (r) => (r.requiresConsent ? 'Advertising' : 'None') },
    { id: 'status', header: 'Status', cell: (r) => <Badge tone={r.isActive ? 'success' : 'neutral'}>{r.isActive ? 'active' : 'off'}</Badge> },
    {
      id: 'actions',
      header: '',
      cell: (r) => (
        <form action={deleteTagAction}>
          <input type="hidden" name="id" value={r.id} />
          <Button type="submit" size="sm" variant="ghost">
            Delete
          </Button>
        </form>
      ),
    },
  ];
  const conversionColumns: Column<ConversionEventRow>[] = [
    { id: 'when', header: 'When', cell: (r) => when(r.createdAt) },
    { id: 'event', header: 'Event', cell: (r) => r.name },
    { id: 'destination', header: 'Destination', cell: (r) => r.destination },
    { id: 'status', header: 'Status', cell: (r) => <Badge tone={r.status === 'sent' ? 'success' : r.status === 'failed' ? 'danger' : 'neutral'}>{r.status}</Badge> },
    { id: 'id', header: 'Event id', cell: (r) => <span className="font-mono text-xs">{r.eventId}</span> },
  ];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Pixels & tags</h1>
      {error && <p className="rounded-md bg-danger/10 p-3 text-sm text-danger">{error}</p>}
      {one(searchParams.saved) && <p className="rounded-md bg-success/10 p-3 text-sm text-success">Saved. The storefront picks it up on the next page load.</p>}
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Built-in tags</h2>
        <p className="text-sm text-muted">
          IDs and secrets are entered under <Link className="text-primary underline" href="/admin/settings/marketing">Settings: Marketing</Link>. Every tag loads only after the visitor
          consents; purchases and refunds are also sent from the server (test orders never are).
        </p>
        <ul className="grid gap-2 md:grid-cols-3">
          {builtIn.map((b) => (
            <li key={b.name} className="rounded-lg border border-border bg-surface p-3 text-sm">
              <p className="font-semibold">{b.name}</p>
              <p className="mt-1">{b.id ? <Badge tone="success">{b.id}</Badge> : <Badge tone="neutral">not configured</Badge>}</p>
              <p className="mt-1 text-muted">Consent: {b.consent}</p>
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Custom tags</h2>
        <DataTable columns={tagColumns} rows={rows} rowKey={(r) => r.id} params={params} total={rows.length} pageSize={Math.max(rows.length, 1)} basePath="/admin/marketing/tags" search={false} />
      </section>
      <TagForm key={editing?.id ?? 'new'} tag={editing} />
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Recent server conversions</h2>
        <DataTable columns={conversionColumns} rows={conversions} rowKey={(r) => r.id} params={params} total={conversions.length} pageSize={25} basePath="/admin/marketing/tags" search={false} />
      </section>
    </div>
  );
}
