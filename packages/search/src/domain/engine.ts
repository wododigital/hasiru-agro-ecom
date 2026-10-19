import type { FacetIndex } from '@ecomkit/core/contracts';
import { and, andCount, bitsFrom, decodeBits, fullBits, hasBit, or, popcount, positions, type Bits } from './bitset';
import { KNOWN, type SearchDoc } from './build-index';
import type { FacetConfig, QuickPreset, SortKey } from './facets';

export interface RangeSel {
  min: number | null;
  max: number | null;
}

/** The visitor's selection. Range values are in URL units (rupees for price). */
export interface FacetState {
  values: Readonly<Record<string, readonly string[]>>;
  ranges: Readonly<Record<string, RangeSel>>;
}

export const EMPTY_STATE: FacetState = { values: {}, ranges: {} };

interface LoadedFacet {
  label: string;
  values: Map<string, { label: string; bits: Bits }>;
  known: Bits;
}

export interface LoadedIndex {
  n: number;
  ids: readonly string[];
  pos: ReadonlyMap<string, number>;
  docs: readonly SearchDoc[];
  facets: ReadonlyMap<string, LoadedFacet>;
  numeric: Readonly<Record<string, readonly (number | null)[]>>;
}

export function loadIndex(index: FacetIndex & { docs?: readonly SearchDoc[] }): LoadedIndex {
  const n = index.ids.length;
  const facets = new Map<string, LoadedFacet>();
  for (const [key, f] of Object.entries(index.facets)) {
    const values = new Map<string, { label: string; bits: Bits }>();
    let known: Bits | null = null;
    let union = bitsFrom(n, []);
    for (const [v, { label, bits }] of Object.entries(f.values)) {
      const b = decodeBits(bits, n);
      if (v === KNOWN) known = b;
      else {
        values.set(v, { label, bits: b });
        union = or(union, b);
      }
    }
    facets.set(key, { label: f.label, values, known: known ?? union });
  }
  return { n, ids: index.ids, pos: new Map(index.ids.map((id, i) => [id, i])), docs: index.docs ?? [], facets, numeric: index.numeric };
}

/** A facet computed at request time (e.g. "fits my district"); every product counts as known. */
export interface ExtraFacet {
  key: string;
  label: string;
  values: Readonly<Record<string, { label: string; ids: readonly string[] }>>;
}

export function withExtraFacets(ix: LoadedIndex, extras: readonly ExtraFacet[]): LoadedIndex {
  if (!extras.length) return ix;
  const facets = new Map(ix.facets);
  for (const e of extras) {
    const values = new Map<string, { label: string; bits: Bits }>();
    for (const [v, { label, ids }] of Object.entries(e.values)) values.set(v, { label, bits: bitsFrom(ix.n, ids.map((id) => ix.pos.get(id) ?? -1)) });
    facets.set(e.key, { label: e.label, values, known: fullBits(ix.n) });
  }
  return { ...ix, facets };
}

export function scopeBits(ix: LoadedIndex, scopeIds?: readonly string[] | null): Bits {
  return scopeIds ? bitsFrom(ix.n, scopeIds.map((id) => ix.pos.get(id) ?? -1)) : fullBits(ix.n);
}

/** OR within a facet, AND across facets and ranges. `except` leaves one key out (disjunctive counts). */
export function matchBits(ix: LoadedIndex, config: FacetConfig, state: FacetState, scope: Bits, except?: string): Bits {
  let result = scope;
  for (const def of config.facets) {
    const selected = state.values[def.key];
    const facet = ix.facets.get(def.key);
    if (!selected?.length || def.key === except || !facet) continue;
    let any = bitsFrom(ix.n, []);
    for (const v of selected) {
      const value = facet.values.get(v);
      if (value) any = or(any, value.bits);
    }
    result = and(result, any);
  }
  for (const def of config.ranges) {
    const sel = state.ranges[def.key];
    const col = ix.numeric[def.numeric];
    if (!sel || def.key === except || !col || (sel.min == null && sel.max == null)) continue;
    const lo = sel.min == null ? -Infinity : sel.min * def.scale;
    const hi = sel.max == null ? Infinity : sel.max * def.scale;
    const hits: number[] = [];
    col.forEach((v, i) => {
      if (v != null && v >= lo && v <= hi) hits.push(i);
    });
    result = and(result, bitsFrom(ix.n, hits));
  }
  return result;
}

export interface FacetValueView {
  value: string;
  label: string;
  /** Results if this option were toggled on with the other facets as they are (disjunctive). */
  count: number;
  selected: boolean;
}

export interface FacetGroupView {
  key: string;
  label: string;
  kind: 'multi' | 'toggle';
  values: FacetValueView[];
}

export interface RangeView {
  key: string;
  scale: number;
  format: 'money' | 'number';
  /** Bounds of the scope, URL units. */
  bounds: { min: number; max: number };
  selected: RangeSel | null;
  presets: readonly RangeSel[];
}

export type Chip = { kind: 'value'; key: string; value: string; label: string } | { kind: 'range'; key: string; min: number | null; max: number | null };

export interface FacetView {
  total: number;
  /** Matching product ids, sorted. */
  ids: string[];
  groups: FacetGroupView[];
  ranges: RangeView[];
  chips: Chip[];
  /** Zero results only: what removing each chip would yield. */
  drops: { chip: Chip; count: number }[];
  /** Zero results only: relax the least important filters until something matches. */
  closest: { relaxed: string[]; ids: string[] } | null;
}

export interface ViewOptions {
  scope?: Bits;
  sort?: SortKey;
  /** Relevance order (search hits). */
  order?: readonly string[];
}

function sortPositions(ix: LoadedIndex, list: number[], sort: SortKey, order?: readonly string[]): number[] {
  const inStock = ix.facets.get('stock')?.values.get('in')?.bits;
  const byNum = (col: string, dir: 1 | -1) => {
    const c = ix.numeric[col];
    return (a: number, b: number) => {
      const x = c?.[a] ?? null;
      const y = c?.[b] ?? null;
      if (x == null || y == null) return x == null ? (y == null ? a - b : 1) : -1;
      return (x - y) * dir || a - b;
    };
  };
  switch (sort) {
    case 'price_asc':
      return list.sort(byNum('price', 1));
    case 'price_desc':
      return list.sort(byNum('price', -1));
    case 'bearing':
      return list.sort(byNum('bear', 1));
    case 'newest':
      return list.sort(byNum('newest', -1));
    case 'relevance': {
      if (!order) return list;
      const rank = new Map(order.map((id, i) => [ix.pos.get(id), i]));
      return list.sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) || a - b);
    }
    default: {
      // Recommended: in stock first, then source order (bestsellers first).
      const s = (i: number) => (inStock && !hasBit(inStock, i) ? 1 : 0);
      return list.sort((a, b) => s(a) - s(b) || a - b);
    }
  }
}

export function stateChips(ix: LoadedIndex, config: FacetConfig, state: FacetState): Chip[] {
  const chips: Chip[] = [];
  for (const def of config.facets) {
    const facet = ix.facets.get(def.key);
    for (const v of state.values[def.key] ?? []) {
      if (!facet) continue;
      const label = def.kind === 'toggle' ? facet.label : (facet.values.get(v)?.label ?? v);
      chips.push({ kind: 'value', key: def.key, value: v, label });
    }
  }
  for (const def of config.ranges) {
    const r = state.ranges[def.key];
    if (r && (r.min != null || r.max != null)) chips.push({ kind: 'range', key: def.key, min: r.min, max: r.max });
  }
  return chips;
}

const priorityOf = (config: FacetConfig, key: string) =>
  config.facets.find((f) => f.key === key)?.priority ?? config.ranges.find((r) => r.key === key)?.priority ?? 0;

/** Everything the filter UI renders, from one pass over the index. Runs on the server (first paint) and in the browser. */
export function computeView(ix: LoadedIndex, config: FacetConfig, state: FacetState, options: ViewOptions = {}): FacetView {
  const scope = options.scope ?? fullBits(ix.n);
  const scopeCount = popcount(scope);
  const sort = options.sort ?? 'recommended';
  const matched = matchBits(ix, config, state, scope);
  const total = popcount(matched);

  const groups: FacetGroupView[] = [];
  for (const def of config.facets) {
    const facet = ix.facets.get(def.key);
    if (!facet) continue;
    const selected = new Set(state.values[def.key] ?? []);
    const knownCount = andCount(facet.known, scope);
    const inScope = [...facet.values].filter(([, v]) => andCount(v.bits, scope) > 0);
    let distinct = inScope.length;
    if (def.kind === 'toggle') {
      const t = facet.values.get(def.toggleValue ?? '');
      const c = t ? andCount(t.bits, scope) : 0;
      distinct = (c > 0 ? 1 : 0) + (c < knownCount ? 1 : 0);
    }
    // Auto-hide: fewer than 2 values, or more than 60% unknown, in the current scope. Never hide an active facet.
    if (!selected.size && (distinct < 2 || knownCount < scopeCount * 0.4)) continue;
    const base = matchBits(ix, config, state, scope, def.key);
    const entries = def.kind === 'toggle' ? [...facet.values].filter(([v]) => v === def.toggleValue) : [...facet.values];
    groups.push({
      key: def.key,
      label: facet.label,
      kind: def.kind,
      values: entries.map(([value, v]) => ({ value, label: v.label, count: andCount(base, v.bits), selected: selected.has(value) })),
    });
  }

  const ranges: RangeView[] = [];
  for (const def of config.ranges) {
    const col = ix.numeric[def.numeric];
    if (!col) continue;
    const vals = positions(scope)
      .map((i) => col[i])
      .filter((v): v is number => v != null);
    const sel = state.ranges[def.key] ?? null;
    if (!sel && (new Set(vals).size < 2 || vals.length < scopeCount * 0.4)) continue;
    const lo = vals.length ? Math.min(...vals) : 0;
    const hi = vals.length ? Math.max(...vals) : 0;
    ranges.push({ key: def.key, scale: def.scale, format: def.format, bounds: { min: Math.floor(lo / def.scale), max: Math.ceil(hi / def.scale) }, selected: sel, presets: def.presets });
  }

  const chips = stateChips(ix, config, state);
  const ids = sortPositions(ix, positions(matched), sort, options.order).map((i) => ix.ids[i]!);
  let drops: FacetView['drops'] = [];
  let closest: FacetView['closest'] = null;
  if (total === 0 && chips.length) {
    drops = chips.map((chip) => ({ chip, count: popcount(matchBits(ix, config, removeChip(state, chip), scope)) }));
    const keys = [...new Set(chips.map((c) => c.key))].sort((a, b) => priorityOf(config, b) - priorityOf(config, a));
    const closestFrom = (relaxed: string[], m: Bits) => ({ relaxed, ids: sortPositions(ix, positions(m), sort, options.order).slice(0, config.pageSize).map((i) => ix.ids[i]!) });
    // One filter dropped is closest: the least important key that alone yields results.
    for (const key of keys) {
      const m = matchBits(ix, config, clearKey(state, key), scope);
      if (popcount(m)) {
        closest = closestFrom([key], m);
        break;
      }
    }
    // Otherwise relax cumulatively, least important first.
    let relaxedState = state;
    const relaxed: string[] = [];
    for (const key of closest ? [] : keys) {
      relaxedState = clearKey(relaxedState, key);
      relaxed.push(key);
      const m = matchBits(ix, config, relaxedState, scope);
      if (popcount(m)) {
        closest = closestFrom(relaxed, m);
        break;
      }
    }
  }
  return { total, ids, groups, ranges, chips, drops, closest };
}

// ---- pure state transitions (shared by the sidebar, the sheet draft and quick chips) ----

export function toggleValue(state: FacetState, key: string, value: string): FacetState {
  const cur = state.values[key] ?? [];
  const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
  return { ...state, values: { ...state.values, [key]: next } };
}

export function setRange(state: FacetState, key: string, range: RangeSel | null): FacetState {
  const ranges = { ...state.ranges };
  if (!range || (range.min == null && range.max == null)) delete ranges[key];
  else ranges[key] = range;
  return { ...state, ranges };
}

export function clearKey(state: FacetState, key: string): FacetState {
  const ranges = { ...state.ranges };
  delete ranges[key];
  return { values: { ...state.values, [key]: [] }, ranges };
}

export function removeChip(state: FacetState, chip: Chip): FacetState {
  return chip.kind === 'range' ? setRange(state, chip.key, null) : toggleValue(state, chip.key, chip.value);
}

/** Clear all: every facet explicitly empty, so defaults (in stock) do not come back. */
export function clearAll(config: FacetConfig): FacetState {
  return { values: Object.fromEntries(config.facets.map((f) => [f.key, []])), ranges: {} };
}

export function presetActive(state: FacetState, preset: QuickPreset): boolean {
  const valuesOn = Object.entries(preset.values ?? {}).every(([k, vs]) => vs.every((v) => state.values[k]?.includes(v)));
  const rangesOn = Object.entries(preset.ranges ?? {}).every(([k, r]) => state.ranges[k]?.min === r.min && state.ranges[k]?.max === r.max);
  return valuesOn && rangesOn;
}

export function togglePreset(state: FacetState, preset: QuickPreset): FacetState {
  const on = presetActive(state, preset);
  let next = state;
  for (const [k, vs] of Object.entries(preset.values ?? {})) {
    for (const v of vs) if (on || !next.values[k]?.includes(v)) next = toggleValue(next, k, v);
  }
  for (const [k, r] of Object.entries(preset.ranges ?? {})) next = setRange(next, k, on ? null : r);
  return next;
}
