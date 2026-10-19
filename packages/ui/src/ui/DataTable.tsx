import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '../cn';
import { nextSort, pageCount, tableQuery, type TableParams } from '../domain/table-params';
import { uiMessages } from '../messages';
import { DataTableToolbarIsland, type ToolbarFilter } from './DataTableToolbarIsland';
import { EmptyState } from './EmptyState';
import { TBody, THead, Table, Td, Th, Tr } from './Table';

export interface Column<Row> {
  id: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  sortable?: boolean;
  align?: 'left' | 'right';
  className?: string;
}

export interface DataTableProps<Row> {
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** From `parseTableParams(searchParams, spec)` on the server page. */
  params: TableParams;
  total: number;
  pageSize: number;
  /** Pathname of the list page; links and the toolbar write query strings onto it. */
  basePath: string;
  filters?: readonly ToolbarFilter[];
  /** Show the search box (searches `q`). */
  search?: boolean;
  empty?: ReactNode;
  labels?: Partial<(typeof uiMessages)['table']>;
  className?: string;
}

/**
 * The one admin list: server-rendered rows, every bit of state (q, filters, sort, page) in the URL,
 * so lists are linkable and work without JS. Pages stay small (server pagination) instead of virtualising.
 */
export function DataTable<Row>({ columns, rows, rowKey, params, total, pageSize, basePath, filters = [], search = true, empty, labels, className }: DataTableProps<Row>) {
  const l = { ...uiMessages.table, ...labels };
  const pages = pageCount(total, pageSize);
  const href = (patch: Parameters<typeof tableQuery>[1]) => basePath + tableQuery(params, patch);
  const prevHref = params.page > 1 ? href({ page: params.page - 1 }) : null;
  const nextHref = params.page < pages ? href({ page: params.page + 1 }) : null;
  const pager = 'grid size-9 place-items-center rounded-sm border border-border bg-surface hover:bg-surface-2';

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {search || filters.length ? <DataTableToolbarIsland basePath={basePath} params={params} filters={filters} search={search} labels={{ search: l.search, all: l.all }} /> : null}
      {rows.length === 0 ? (
        (empty ?? <EmptyState title={l.empty} />)
      ) : (
        <Table>
          <THead>
            <tr>
              {columns.map((c) => {
                const active = params.sort === c.id;
                const sortState = active ? (params.dir === 'asc' ? 'ascending' : 'descending') : undefined;
                return (
                  <Th key={c.id} aria-sort={c.sortable ? (sortState ?? 'none') : undefined} className={cn(c.align === 'right' && 'text-right', c.className)}>
                    {c.sortable ? (
                      <Link href={href(nextSort(params, c.id))} className="inline-flex items-center gap-1 hover:text-text" scroll={false}>
                        {c.header}
                        {active ? params.dir === 'asc' ? <ArrowUp aria-hidden="true" className="size-3.5" /> : <ArrowDown aria-hidden="true" className="size-3.5" /> : null}
                        {active ? <span className="sr-only">{params.dir === 'asc' ? l.sortAsc : l.sortDesc}</span> : null}
                      </Link>
                    ) : (
                      c.header
                    )}
                  </Th>
                );
              })}
            </tr>
          </THead>
          <TBody>
            {rows.map((row) => (
              <Tr key={rowKey(row)}>
                {columns.map((c) => (
                  <Td key={c.id} className={cn(c.align === 'right' && 'text-right tabular-nums', c.className)}>
                    {c.cell(row)}
                  </Td>
                ))}
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
      {pages > 1 ? (
        <nav aria-label={l.pageOf(params.page, pages)} className="flex items-center justify-end gap-2 text-sm text-muted">
          <span className="tabular-nums">{l.pageOf(params.page, pages)}</span>
          {prevHref ? (
            <Link href={prevHref} aria-label={l.previous} className={pager}>
              <ChevronLeft aria-hidden="true" className="size-4" />
            </Link>
          ) : null}
          {nextHref ? (
            <Link href={nextHref} aria-label={l.next} className={pager}>
              <ChevronRight aria-hidden="true" className="size-4" />
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
