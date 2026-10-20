import { dynamicRequest } from '../server/request';
import { Badge, Button, DataTable, type Column } from '@ecomkit/ui';
import { parseTableParams, type SearchParamsInput } from '@ecomkit/ui/domain';
import Link from 'next/link';
import { ISSUE_STATUSES, listIssues } from '../server/views';
import { issueStatusAction } from './actions';
import { ago, ist } from './format';
import { HealthTabs } from './HealthTabs';

type Issue = Awaited<ReturnType<typeof listIssues>>['rows'][number];
const PAGE_SIZE = 50;
const SPEC = { filters: { status: [...ISSUE_STATUSES] } } as const;

export function IssueStatusButtons({ issue }: { issue: Pick<Issue, 'id' | 'status'> }) {
  const next = issue.status === 'open' ? (['resolved', 'ignored'] as const) : (['open'] as const);
  return (
    <div className="flex gap-2">
      {next.map((status) => (
        <form key={status} action={issueStatusAction}>
          <input type="hidden" name="id" value={issue.id} />
          <input type="hidden" name="status" value={status} />
          <Button type="submit" size="sm" variant={status === 'resolved' ? 'subtle' : 'ghost'} data-cta={`error-${status}`}>
            {status === 'resolved' ? 'Resolve' : status === 'ignored' ? 'Ignore' : 'Reopen'}
          </Button>
        </form>
      ))}
    </div>
  );
}

const columns = (now: Date): Column<Issue>[] => [
  {
    id: 'title',
    header: 'Error',
    cell: (i) => (
      <Link href={`/admin/health/errors/${i.id}`} className="font-medium text-text hover:underline">
        {i.title}
      </Link>
    ),
  },
  { id: 'level', header: 'Level', cell: (i) => <Badge tone={i.level === 'error' ? 'danger' : 'warning'}>{i.level}</Badge> },
  { id: 'count', header: 'Events', align: 'right', cell: (i) => <span className="tabular-nums">{i.count}</span> },
  { id: 'last', header: 'Last seen', cell: (i) => <span title={`First ${ist(i.firstSeen)}`}>{ago(i.lastSeen, now)}</span> },
  { id: 'release', header: 'Release', cell: (i) => <span className="font-mono text-xs">{i.release?.slice(0, 8) ?? ''}</span> },
  { id: 'actions', header: <span className="sr-only">Actions</span>, cell: (i) => <IssueStatusButtons issue={i} /> },
];

/** Server errors grouped by fingerprint (core observability). */
export async function ErrorsPage({ searchParams, now: nowOverride }: { searchParams: SearchParamsInput; now?: Date }) {
  await dynamicRequest();
  const now = nowOverride ?? new Date();
  const params = parseTableParams(searchParams, SPEC);
  const status = (params.filters.status ?? 'open') as (typeof ISSUE_STATUSES)[number];
  const { rows, total } = await listIssues({ status, page: params.page, pageSize: PAGE_SIZE });
  return (
    <div className="flex flex-col gap-6">
      <HealthTabs active="/admin/health/errors" title="Errors" />
      <DataTable
        columns={columns(now)}
        rows={rows}
        rowKey={(i) => i.id}
        params={params}
        total={total}
        pageSize={PAGE_SIZE}
        basePath="/admin/health/errors"
        search={false}
        filters={[{ key: 'status', label: 'Status', options: ISSUE_STATUSES.map((s) => ({ value: s, label: s })) }]}
      />
    </div>
  );
}
