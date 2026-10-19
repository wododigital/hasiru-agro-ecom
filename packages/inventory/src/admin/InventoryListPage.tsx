import { DataTable, type Column } from '@ecomkit/ui';
import { parseTableParams, type SearchParamsInput } from '@ecomkit/ui/domain';
import Link from 'next/link';
import { LEVEL_FILTERS, LEVEL_SORTS, listLevels, type LevelListRow } from '../server';
import { formatIst, SOURCE_LABEL, STATE_LABEL } from './format';
import { SourceBadge, StateBadge } from './LevelCard';

const PAGE_SIZE = 50;
const BASE = '/admin/inventory';

const columns: Column<LevelListRow>[] = [
  {
    id: 'sku',
    header: 'Variant',
    sortable: true,
    cell: (r) => (
      <Link href={`${BASE}/${r.variantId}`} className="font-medium text-primary hover:underline">
        {r.sku ?? r.variantId}
      </Link>
    ),
  },
  { id: 'state', header: 'State', cell: (r) => <StateBadge level={r} /> },
  { id: 'onHand', header: 'On hand', align: 'right', cell: (r) => r.onHand },
  { id: 'reserved', header: 'Reserved', align: 'right', cell: (r) => r.reserved },
  { id: 'available', header: 'Sellable', align: 'right', sortable: true, cell: (r) => r.available },
  { id: 'erp', header: 'ERP reports', align: 'right', cell: (r) => r.erpOnHand ?? '-' },
  { id: 'source', header: 'Source', cell: (r) => <SourceBadge source={r.source} /> },
  { id: 'updated', header: 'Updated', sortable: true, cell: (r) => formatIst(r.updatedAt) },
];

/** /admin/inventory: every variant level, URL-bound filters (source, state), search by SKU or id. */
export async function InventoryListPage({ searchParams }: { searchParams: SearchParamsInput }) {
  const params = parseTableParams(searchParams, { filters: LEVEL_FILTERS, sorts: LEVEL_SORTS, defaultSort: { id: 'sku', dir: 'asc' } });
  const { rows, total } = await listLevels(params, PAGE_SIZE);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-text">Inventory</h1>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.variantId}
        params={params}
        total={total}
        pageSize={PAGE_SIZE}
        basePath={BASE}
        filters={[
          { key: 'source', label: 'Source', options: LEVEL_FILTERS.source.map((v) => ({ value: v, label: SOURCE_LABEL[v] })) },
          { key: 'state', label: 'State', options: LEVEL_FILTERS.state.map((v) => ({ value: v, label: v === 'low' ? 'Low stock' : STATE_LABEL[v] })) },
        ]}
      />
    </div>
  );
}
