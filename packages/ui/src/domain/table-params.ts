import { z } from 'zod';

/**
 * URL-bound list state for DataTable (and any admin list): one pattern, everything in searchParams.
 * Param order is fixed (q, filters in declared order, sort, dir, page) so URLs are stable.
 */

export type SearchParamsInput = Record<string, string | string[] | undefined> | URLSearchParams;

export interface TableParamsSpec {
  /** Filter keys this list accepts, each with its allowed values (anything else is dropped). */
  filters?: Readonly<Record<string, readonly string[]>>;
  /** Column ids that may be sorted. */
  sorts?: readonly string[];
  defaultSort?: { id: string; dir: 'asc' | 'desc' };
}

export interface TableParams {
  q: string;
  filters: Record<string, string>;
  sort: string | null;
  dir: 'asc' | 'desc';
  page: number;
}

const first = (input: SearchParamsInput, key: string): string | undefined => {
  if (input instanceof URLSearchParams) return input.get(key) ?? undefined;
  const v = input[key];
  return Array.isArray(v) ? v[0] : v;
};

const pageSchema = z.coerce.number().int().min(1).max(10_000).catch(1);
const qSchema = z.string().trim().max(200).catch('');

export function parseTableParams(input: SearchParamsInput, spec: TableParamsSpec = {}): TableParams {
  const filters: Record<string, string> = {};
  for (const [key, allowed] of Object.entries(spec.filters ?? {})) {
    const v = first(input, key);
    if (v !== undefined && allowed.includes(v)) filters[key] = v;
  }
  const rawSort = first(input, 'sort');
  const sort = rawSort && spec.sorts?.includes(rawSort) ? rawSort : (spec.defaultSort?.id ?? null);
  const rawDir = first(input, 'dir');
  const dir = rawDir === 'asc' || rawDir === 'desc' ? rawDir : (spec.defaultSort?.dir ?? 'asc');
  return {
    q: qSchema.parse(first(input, 'q') ?? ''),
    filters,
    sort,
    dir,
    page: pageSchema.parse(first(input, 'page') ?? 1),
  };
}

/** Query string for `params` with `patch` applied. Changing q, a filter or the sort resets page to 1. Defaults are omitted. */
export function tableQuery(params: TableParams, patch: Partial<Omit<TableParams, 'filters'>> & { filters?: Record<string, string | null> } = {}): string {
  const resetsPage = patch.q !== undefined || patch.filters !== undefined || patch.sort !== undefined || patch.dir !== undefined;
  const filters: Record<string, string> = { ...params.filters };
  for (const [k, v] of Object.entries(patch.filters ?? {})) {
    if (v === null || v === '') delete filters[k];
    else filters[k] = v;
  }
  const next: TableParams = {
    q: patch.q ?? params.q,
    filters,
    sort: patch.sort !== undefined ? patch.sort : params.sort,
    dir: patch.dir ?? params.dir,
    page: patch.page ?? (resetsPage ? 1 : params.page),
  };
  const out = new URLSearchParams();
  if (next.q) out.set('q', next.q);
  for (const [k, v] of Object.entries(next.filters)) out.set(k, v);
  if (next.sort) {
    out.set('sort', next.sort);
    out.set('dir', next.dir);
  }
  if (next.page > 1) out.set('page', String(next.page));
  const s = out.toString();
  return s ? `?${s}` : '';
}

/** Next sort state when a header is clicked: new column asc, same column toggles. */
export function nextSort(params: TableParams, id: string): { sort: string; dir: 'asc' | 'desc' } {
  return { sort: id, dir: params.sort === id && params.dir === 'asc' ? 'desc' : 'asc' };
}

export const pageCount = (total: number, pageSize: number): number => Math.max(1, Math.ceil(total / pageSize));
