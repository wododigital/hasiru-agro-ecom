import { Badge, DataTable, type Column } from '@ecomkit/ui';
import { parseTableParams, type SearchParamsInput } from '@ecomkit/ui/domain';
import { listCheckLog, listIntegrationLog, providers } from '../server/views';
import { ist } from './format';
import { HealthTabs } from './HealthTabs';

type IntegrationRow = Awaited<ReturnType<typeof listIntegrationLog>>['rows'][number];
type CheckRow = Awaited<ReturnType<typeof listCheckLog>>['rows'][number];
const PAGE_SIZE = 50;
const STATUSES = ['ok', 'failed', 'skipped_not_configured'] as const;

const integrationColumns: Column<IntegrationRow>[] = [
  { id: 'at', header: 'When', cell: (r) => ist(r.createdAt) },
  { id: 'provider', header: 'Provider', cell: (r) => <span className="font-mono text-xs">{r.provider}</span> },
  { id: 'op', header: 'Operation', cell: (r) => <span className="font-mono text-xs">{r.op}</span> },
  { id: 'status', header: 'Status', cell: (r) => <Badge tone={r.status === 'ok' ? 'success' : r.status === 'failed' ? 'danger' : 'outline'}>{r.status}</Badge> },
  { id: 'ms', header: 'ms', align: 'right', cell: (r) => <span className="tabular-nums">{r.durationMs}</span> },
  { id: 'http', header: 'HTTP', cell: (r) => r.httpStatus ?? '' },
  { id: 'error', header: 'Error', cell: (r) => <span className="line-clamp-2 text-xs text-muted">{r.error ?? ''}</span> },
];

const checkColumns: Column<CheckRow>[] = [
  { id: 'at', header: 'When', cell: (r) => ist(r.createdAt) },
  { id: 'check', header: 'Check', cell: (r) => <span className="font-mono text-xs">{r.check}</span> },
  { id: 'ok', header: 'Result', cell: (r) => (r.ok ? <Badge tone="success">ok</Badge> : <Badge tone="danger">failing</Badge>) },
  { id: 'ms', header: 'ms', align: 'right', cell: (r) => <span className="tabular-nums">{r.latencyMs ?? ''}</span> },
  { id: 'detail', header: 'Detail', cell: (r) => <span className="line-clamp-2 font-mono text-xs text-muted">{r.detail ? JSON.stringify(r.detail) : ''}</span> },
];

/** Typed logs: integration calls (by provider and status) and check results (failing only on request). */
export async function LogsPage({ searchParams }: { searchParams: SearchParamsInput }) {
  const known = await providers();
  const params = parseTableParams(searchParams, { filters: { type: ['integration', 'checks'], provider: known, status: [...STATUSES], result: ['failing'] } });
  const type = params.filters.type ?? 'integration';
  const common = { params, pageSize: PAGE_SIZE, basePath: '/admin/health/logs', search: false } as const;
  const typeFilter = { key: 'type', label: 'Log', options: [{ value: 'integration', label: 'Integration calls' }, { value: 'checks', label: 'Check results' }] };

  const table =
    type === 'checks' ? (
      <DataTable
        {...common}
        columns={checkColumns}
        {...(await listCheckLog({ failedOnly: params.filters.result === 'failing', page: params.page, pageSize: PAGE_SIZE }))}
        rowKey={(r) => String(r.id)}
        filters={[typeFilter, { key: 'result', label: 'Result', options: [{ value: 'failing', label: 'Failing only' }] }]}
      />
    ) : (
      <DataTable
        {...common}
        columns={integrationColumns}
        {...(await listIntegrationLog({ provider: params.filters.provider, status: params.filters.status as (typeof STATUSES)[number] | undefined, page: params.page, pageSize: PAGE_SIZE }))}
        rowKey={(r) => String(r.id)}
        filters={[
          typeFilter,
          { key: 'provider', label: 'Provider', options: known.map((p) => ({ value: p, label: p })) },
          { key: 'status', label: 'Status', options: STATUSES.map((s) => ({ value: s, label: s })) },
        ]}
      />
    );

  return (
    <div className="flex flex-col gap-6">
      <HealthTabs active="/admin/health/logs" title="Logs" />
      {table}
    </div>
  );
}
