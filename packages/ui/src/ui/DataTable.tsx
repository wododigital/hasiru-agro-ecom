import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, X } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '../cn';
import { nextSort, pageCount, tableQuery, type TableParams } from '../domain/table-params';
import { uiMessages } from '../messages';
import { DataTableToolbarIsland, type ToolbarFilter } from './DataTableToolbarIsland';
import { EmptyState } from './EmptyState';
import { SelectAllIsland } from './SelectAllIsland';
import { Skeleton } from './Skeleton';
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
  /** Saved-view tabs above the table (Shopify): each is a filter preset. An "All" tab is always first. */
  views?: readonly TableView[];
  /** Whole-row click target (the detail page). The first cell carries the real link; the rest of the row extends it. */
  rowHref?: (row: Row) => string;
  /** Row checkboxes (`ids`) plus a bulk-action bar shown once a row is ticked. Each action is a server action. */
  bulkActions?: readonly BulkAction[];
}

export interface TableView {
  id: string;
  label: string;
  filters: Readonly<Record<string, string>>;
}

export interface BulkAction {
  label: string;
  /** A server action, or a URL that receives the ticked `ids` by GET (a download such as a CSV export). */
  action: ((form: FormData) => void | Promise<void>) | string;
  tone?: 'default' | 'danger';
}

/** The tab to highlight: the view with the most filters that are all applied (extra filters show as chips); else All. */
function activeView<V extends { filters: Readonly<Record<string, string>> }>(views: readonly V[], applied: Readonly<Record<string, string>>): V | undefined {
  return views
    .filter((v) => Object.entries(v.filters).every(([k, val]) => applied[k] === val))
    .sort((a, b) => Object.keys(b.filters).length - Object.keys(a.filters).length)[0];
}

/** Loading state for an index page: toolbar plus rows. */
export function DataTableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <Skeleton className="h-9 w-full" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

/**
 * The one admin list: server-rendered rows, every bit of state (q, filters, sort, page) in the URL,
 * so lists are linkable and work without JS. Pages stay small (server pagination) instead of virtualising.
 */
export function DataTable<Row>({ columns, rows, rowKey, params, total, pageSize, basePath, filters = [], search = true, empty, labels, className, views, rowHref, bulkActions }: DataTableProps<Row>) {
  const l = { ...uiMessages.table, ...labels };
  const pages = pageCount(total, pageSize);
  const href = (patch: Parameters<typeof tableQuery>[1]) => basePath + tableQuery(params, patch);
  const prevHref = params.page > 1 ? href({ page: params.page - 1 }) : null;
  const nextHref = params.page < pages ? href({ page: params.page + 1 }) : null;
  const pager = 'grid size-9 place-items-center rounded-sm border border-border bg-surface hover:bg-surface-2';
  const viewHref = (f: Readonly<Record<string, string>>) => basePath + tableQuery({ q: '', filters: {}, sort: params.sort, dir: params.dir, page: 1 }, { filters: { ...f } });
  const tabs = views?.length ? [{ id: 'all', label: l.all, filters: {} }, ...views] : [];
  const current = activeView(tabs, params.filters);
  // The active saved view's own filters are the tab, not chips.
  const viewKeys = new Set(Object.keys(current?.filters ?? {}));
  const chips = Object.entries(params.filters).filter(([key]) => !viewKeys.has(key)).map(([key, value]) => {
    const f = filters.find((x) => x.key === key);
    return { key, label: `${f?.label ?? key}: ${f?.options.find((o) => o.value === value)?.label ?? value}` };
  });
  const bulk = bulkActions?.length ? bulkActions : null;
  const Wrap = bulk ? 'form' : 'div';

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {tabs.length ? (
        <nav aria-label={l.views} className="flex gap-1 overflow-x-auto border-b border-border">
          {tabs.map((v) => {
            const on = v.id === current?.id;
            return (
              <Link
                key={v.id}
                href={viewHref(v.filters)}
                aria-current={on ? 'page' : undefined}
                scroll={false}
                className={cn('-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap', on ? 'border-primary font-semibold text-text' : 'border-transparent text-muted hover:text-text')}
              >
                {v.label}
              </Link>
            );
          })}
        </nav>
      ) : null}
      {search || filters.length ? <DataTableToolbarIsland basePath={basePath} params={params} filters={filters} search={search} labels={{ search: l.search, all: l.all }} /> : null}
      {chips.length ? (
        <ul aria-label={l.activeFilters} className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <li key={c.key}>
              <Link href={href({ filters: { [c.key]: null } })} scroll={false} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1 text-xs hover:bg-surface-2" aria-label={l.removeFilter(c.label)}>
                {c.label}
                <X aria-hidden="true" className="size-3" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {rows.length === 0 ? (
        (empty ?? <EmptyState title={l.empty} />)
      ) : (
        <Wrap className="group/bulk flex flex-col gap-2">
          {bulk ? (
            <div role="toolbar" aria-label={l.bulk} className="hidden flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 group-has-[input[name=ids]:checked]/bulk:flex">
              <span className="text-sm text-muted">{l.selected}</span>
              {bulk.map((b) => (
                <button key={b.label} type="submit" formAction={b.action} formMethod={typeof b.action === 'string' ? 'get' : undefined} className={cn('rounded-sm border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2', b.tone === 'danger' && 'text-danger')}>
                  {b.label}
                </button>
              ))}
            </div>
          ) : null}
        <Table>
          <THead>
            <tr>
              {bulk ? (
                <Th className="w-10">
                  <SelectAllIsland label={l.selectAll} />
                </Th>
              ) : null}
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
            {rows.map((row) => {
              const to = rowHref?.(row);
              return (
                <Tr key={rowKey(row)} className={cn(to && 'relative cursor-pointer')}>
                  {bulk ? (
                    <Td className="relative z-10 w-10">
                      <input type="checkbox" name="ids" value={rowKey(row)} aria-label={l.selectRow} className="size-4 accent-primary" />
                    </Td>
                  ) : null}
                  {columns.map((c, i) => (
                    <Td key={c.id} className={cn(c.align === 'right' && 'text-right tabular-nums', c.className)}>
                      {to && i === 0 ? (
                        <Link href={to} className="font-medium after:absolute after:inset-0 hover:underline">
                          {c.cell(row)}
                        </Link>
                      ) : (
                        c.cell(row)
                      )}
                    </Td>
                  ))}
                </Tr>
              );
            })}
          </TBody>
        </Table>
        </Wrap>
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
