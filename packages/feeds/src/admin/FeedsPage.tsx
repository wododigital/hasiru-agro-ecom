// Marketing > Product feeds (admin copy is English-only, exempt from messages).
import { can, requirePermission } from '@ecomkit/core/auth-context';
import { Badge, Button, DataTable, Stat, type Column } from '@ecomkit/ui';
import { parseTableParams } from '@ecomkit/ui/domain';
import Link from 'next/link';
import { DESTINATIONS, type Destination } from '../domain/item';
import type { FeedItemStateRow, FeedRunRow } from '../schema';
import { feedOrigin, loadSettings } from '../server/config';
import { feedStatus } from '../server/serve';
import { rebuildFeedsAction } from './actions';

const when = (d: Date | null) => (d ? d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '-');
const LABEL: Record<Destination, string> = { google: 'Google Merchant Center', meta: 'Meta catalog' };
const PATH: Record<Destination, string> = { google: '/feeds/google.xml', meta: '/feeds/meta.csv' };

export async function FeedsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const staff = await requirePermission('marketing.write');
  const params = parseTableParams(searchParams);
  const [s, statuses] = await Promise.all([loadSettings(), Promise.all(DESTINATIONS.map(async (d) => [d, await feedStatus(d)] as const))]);
  const origin = feedOrigin();
  const showToken = can(staff, 'settings.secrets');
  const url = (d: Destination) => `${origin}${PATH[d]}?token=${s.feedToken ? (showToken ? s.feedToken : '••••••••') : 'GENERATE-A-TOKEN'}`;

  const runColumns: Column<FeedRunRow>[] = [
    { id: 'when', header: 'When', cell: (r) => when(r.startedAt) },
    { id: 'kind', header: 'Kind', cell: (r) => r.kind },
    { id: 'items', header: 'Items', align: 'right', cell: (r) => r.items },
    { id: 'errors', header: 'Rejected', align: 'right', cell: (r) => r.errors },
    { id: 'change', header: 'Change', cell: (r) => (r.log ? (r.log.rewritten ? `+${r.log.added} ~${r.log.changed} -${r.log.removed}` : 'no change, file kept') : '-') },
  ];
  const rejectColumns: Column<FeedItemStateRow>[] = [
    { id: 'variant', header: 'Variant', cell: (r) => <span className="font-mono text-xs">{r.variantId}</span> },
    { id: 'error', header: 'Why it is not in the feed', cell: (r) => r.lastError },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Product feeds</h1>
        <form action={rebuildFeedsAction}>
          <Button type="submit">Rebuild now</Button>
        </form>
      </div>
      <p className="text-sm text-muted">
        Merchant Center and Commerce Manager fetch these files on their schedule (set daily). They rebuild on their own a couple of minutes after a product, price or stock change, and
        only change when an item changed. Token, brand and categories are under <Link className="text-primary underline" href="/admin/settings/feeds">Settings: Feeds</Link>.
      </p>
      {DESTINATIONS.map((d) => {
        const st = statuses.find(([x]) => x === d)![1];
        const on = d === 'google' ? s.googleEnabled : s.metaEnabled;
        return (
          <section key={d} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">{LABEL[d]}</h2>
              <Badge tone={on ? 'success' : 'neutral'}>{on ? 'on' : 'off'}</Badge>
            </div>
            <p className="font-mono text-xs break-all">{url(d)}</p>
            <div className="grid gap-3 md:grid-cols-3">
              <Stat label="Items in file" value={String(st.file?.items ?? 0)} />
              <Stat label="Rejected items" value={String(st.rejected.length)} />
              <Stat label="File built" value={when(st.file?.generatedAt ?? null)} />
            </div>
            <DataTable columns={runColumns} rows={st.runs} rowKey={(r) => r.id} params={params} total={st.runs.length} pageSize={10} basePath="/admin/marketing/feeds" search={false} />
            {st.rejected.length > 0 && (
              <DataTable columns={rejectColumns} rows={st.rejected} rowKey={(r) => r.variantId} params={params} total={st.rejected.length} pageSize={Math.max(st.rejected.length, 1)} basePath="/admin/marketing/feeds" search={false} />
            )}
          </section>
        );
      })}
    </div>
  );
}
