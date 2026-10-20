import { requirePermission } from '@ecomkit/core/auth-context';
import type { Paise } from '@ecomkit/core/contracts';
import { formatINR } from '@ecomkit/core/money';
import { Badge, buttonVariants, DataTable, EmptyState, type Column } from '@ecomkit/ui';
import { parseTableParams, type SearchParamsInput } from '@ecomkit/ui/domain';
import Link from 'next/link';
import { toIstLocal, windowState, type DiscountRule } from '../domain';
import { listRules, type RuleListRow } from '../server/discounts';
import { bulkRuleStatusAction } from './actions';

const describeValue = (r: Pick<DiscountRule, 'valueType' | 'value'>) => (r.valueType === 'percent' ? `${r.value}% off` : `${formatINR(r.value as Paise)} off`);
const when = (d: Date | null) => (d ? toIstLocal(d).replace('T', ' ') : 'open');
const STATE_LABEL = { live: 'Live', inactive: 'Off', not_started: 'Scheduled', ended: 'Ended' } as const;
const STATES = ['live', 'not_started', 'ended', 'inactive'] as const;
const PAGE = 50;

/** /admin/discounts (Shopify index): views by state, search by name, kind filter, row checkboxes for status, whole-row click. Rules are few, so filtering is in memory. */
export async function DiscountsListPage({ searchParams = {}, now: nowOverride }: { searchParams?: SearchParamsInput | Promise<SearchParamsInput>; now?: Date } = {}) {
  await requirePermission('marketing.write');
  // The clock is read only after the request-time marker above (cache components refuse `new Date()` in a prerender).
  const now = nowOverride ?? new Date();
  const params = parseTableParams(await searchParams, { filters: { state: STATES, kind: ['automatic', 'code'] } });
  const q = params.q.toLowerCase();
  const all = (await listRules()).map((r) => ({ ...r, state: windowState(r, now) }));
  const rows = all.filter(
    (r) => (!q || r.name.toLowerCase().includes(q)) && (!params.filters.state || r.state === params.filters.state) && (!params.filters.kind || r.kind === params.filters.kind),
  );
  const columns: Column<RuleListRow & { state: (typeof STATES)[number] }>[] = [
    { id: 'name', header: 'Name', cell: (r) => r.name },
    { id: 'kind', header: 'Type', cell: (r) => (r.kind === 'code' ? `Code (${r.codes})` : 'Automatic') },
    { id: 'value', header: 'Value', cell: (r) => describeValue(r) },
    { id: 'window', header: 'Window (IST)', className: 'whitespace-nowrap', cell: (r) => `${when(r.startsAt)} to ${when(r.endsAt)}` },
    { id: 'state', header: 'State', cell: (r) => <Badge tone={r.state === 'live' ? 'success' : 'neutral'}>{r.state === 'inactive' ? r.status : STATE_LABEL[r.state]}</Badge> },
    { id: 'uses', header: 'Uses', align: 'right', cell: (r) => `${r.uses}${r.usageLimitTotal ? ` / ${r.usageLimitTotal}` : ''}` },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Discounts</h1>
        <Link href="/admin/discounts/new" className={buttonVariants({ size: 'sm' })} data-cta="discounts-new">
          New discount
        </Link>
      </div>
      <DataTable
        columns={columns}
        rows={rows.slice((params.page - 1) * PAGE, params.page * PAGE)}
        rowKey={(r) => r.id}
        rowHref={(r) => `/admin/discounts/${r.id}`}
        params={params}
        total={rows.length}
        pageSize={PAGE}
        basePath="/admin/discounts"
        views={[
          { id: 'live', label: 'Live', filters: { state: 'live' } },
          { id: 'scheduled', label: 'Scheduled', filters: { state: 'not_started' } },
          { id: 'ended', label: 'Ended', filters: { state: 'ended' } },
        ]}
        filters={[{ key: 'kind', label: 'Type', options: [{ value: 'automatic', label: 'Automatic' }, { value: 'code', label: 'Code' }] }]}
        bulkActions={[
          { label: 'Activate', action: bulkRuleStatusAction.bind(null, 'active') },
          { label: 'Pause', action: bulkRuleStatusAction.bind(null, 'paused') },
          { label: 'Archive', action: bulkRuleStatusAction.bind(null, 'archived'), tone: 'danger' },
        ]}
        empty={<EmptyState title={all.length ? 'No discounts match' : 'No discounts yet'} body={all.length ? undefined : 'Create an automatic promotion or a coupon code.'} />}
      />
    </div>
  );
}
