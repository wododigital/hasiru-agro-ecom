import { z } from 'zod';
import type { FacetState, RangeSel } from './engine';
import { KEY_RE, SORTS, VALUE_RE, type FacetConfig, type SortKey } from './facets';

/**
 * URL state, fixed param order `q, f, sort, page`. `f` packs every filter into one readable param:
 * `f=model:food_forest,miyawaki;price:-300;stock:` with keys and values sorted, ranges as `min-max`
 * (either side open), and `key:` (empty) meaning "explicitly off" for a facet that is on by default.
 * Facets equal to their default are left out, so the clean listing URL has no `f`.
 */
export interface UrlState {
  q: string;
  state: FacetState;
  sort: SortKey;
  page: number;
}

const rawSchema = z.object({
  q: z.string().trim().max(80).catch(''),
  f: z.string().max(600).catch(''),
  sort: z.enum(SORTS).catch('recommended'),
  page: z.coerce.number().int().min(1).max(500).catch(1),
});

type ParamsLike = URLSearchParams | Readonly<Record<string, string | readonly string[] | undefined>>;

function read(params: ParamsLike, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const v = params[key];
  return Array.isArray(v) ? v[0] : (v as string | undefined);
}

const num = (s: string): number | null => {
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export function defaultState(config: FacetConfig): FacetState {
  return { values: Object.fromEntries(Object.entries(config.defaults).map(([k, v]) => [k, [...v]])), ranges: {} };
}

/** Parses untrusted query params. Unknown keys and malformed values are dropped, never thrown. */
export function parseUrlState(params: ParamsLike, config: FacetConfig, fallbackSort: SortKey = 'recommended'): UrlState {
  const raw = rawSchema.parse({ q: read(params, 'q') ?? '', f: read(params, 'f') ?? '', sort: read(params, 'sort') ?? fallbackSort, page: read(params, 'page') ?? 1 });
  const facetKeys = new Map(config.facets.map((f) => [f.key, f]));
  const rangeKeys = new Set(config.ranges.map((r) => r.key));
  const base = defaultState(config);
  const values: Record<string, readonly string[]> = { ...base.values };
  const ranges: Record<string, RangeSel> = {};
  for (const part of raw.f.split(';')) {
    const idx = part.indexOf(':');
    if (idx < 1) continue;
    const key = part.slice(0, idx);
    const rest = part.slice(idx + 1);
    if (!KEY_RE.test(key)) continue;
    if (rangeKeys.has(key)) {
      const m = /^(\d*(?:\.\d+)?)-(\d*(?:\.\d+)?)$/.exec(rest);
      if (!m) continue;
      const min = num(m[1]!);
      const max = num(m[2]!);
      if (min != null || max != null) ranges[key] = min != null && max != null && min > max ? { min: max, max: min } : { min, max };
    } else if (facetKeys.has(key)) {
      const def = facetKeys.get(key)!;
      let vs = [...new Set(rest.split(',').filter((v) => VALUE_RE.test(v)))].slice(0, 30);
      if (def.kind === 'toggle') vs = vs.filter((v) => v === def.toggleValue);
      values[key] = vs;
    }
  }
  return { q: raw.q, state: { values, ranges }, sort: raw.sort, page: raw.page };
}

const same = (a: readonly string[] = [], b: readonly string[] = []) => a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');

export function encodeFilters(state: FacetState, config: FacetConfig): string {
  const parts: string[] = [];
  const keys = new Set([...config.facets.map((f) => f.key), ...config.ranges.map((r) => r.key)]);
  for (const key of [...keys].sort()) {
    const r = state.ranges[key];
    if (r && (r.min != null || r.max != null)) {
      parts.push(`${key}:${r.min ?? ''}-${r.max ?? ''}`);
      continue;
    }
    const vs = state.values[key] ?? [];
    if (same(vs, config.defaults[key])) continue;
    parts.push(`${key}:${[...new Set(vs)].sort().join(',')}`);
  }
  return parts.join(';');
}

/** Query string (no `?`) in the fixed order. Defaults are omitted: `recommended` sort, page 1, default filters. */
export function serializeUrlState(u: Partial<UrlState> & { state: FacetState }, config: FacetConfig, defaultSort: SortKey = 'recommended'): string {
  const out: string[] = [];
  if (u.q) out.push(`q=${encodeURIComponent(u.q)}`);
  const f = encodeFilters(u.state, config);
  // `:`, `,`, `;`, `-` and `.` are legal in a query string, so `f` stays readable.
  if (f) out.push(`f=${f}`);
  if (u.sort && u.sort !== defaultSort) out.push(`sort=${u.sort}`);
  if (u.page && u.page > 1) out.push(`page=${u.page}`);
  return out.join('&');
}
