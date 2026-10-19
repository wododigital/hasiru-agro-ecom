'use client';

import { asPaise, formatINR } from '@ecomkit/core/money';
import { createContext, use, useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import type { SearchIndex } from '../domain/build-index';
import {
  computeView,
  loadIndex,
  scopeBits,
  withExtraFacets,
  type Chip,
  type ExtraFacet,
  type FacetState,
  type FacetView,
  type LoadedIndex,
  type RangeSel,
} from '../domain/engine';
import type { FacetConfig, SortKey } from '../domain/facets';
import { fmt } from '../domain';
import { encodeFilters, parseUrlState, serializeUrlState, type UrlState } from '../domain/url-state';
import { searchMessages, type SearchMessages } from '../messages';

export interface FacetContextValue {
  config: FacetConfig;
  messages: SearchMessages;
  url: UrlState;
  view: FacetView;
  defaultSort: SortKey;
  /** True while the index loads or a transition renders. */
  pending: boolean;
  /** New selection (and optionally sort): pushes a history entry, back to page 1. */
  apply(next: FacetState, sort?: SortKey): void;
  setRange(key: string, range: RangeSel | null): void;
  setSort(sort: SortKey): void;
  showMore(): void;
  /** Counts for a draft selection (the mobile sheet); null until the index has loaded. */
  preview(state: FacetState): FacetView | null;
  /** Intent prefetch: start loading /facets.json (hover, focus, sheet open). */
  prefetch(): void;
  /** `Rs 300 to Rs 1,000` style text for a range in URL units. */
  rangeText(key: string, min: number | null, max: number | null): string;
  rangeLabel(chip: Extract<Chip, { kind: 'range' }>): string;
}

const FacetContext = createContext<FacetContextValue | null>(null);

export function useFacets(): FacetContextValue {
  const ctx = use(FacetContext);
  if (!ctx) throw new Error('useFacets() needs a <FacetProvider> above it');
  return ctx;
}

export interface FacetProviderProps {
  config: FacetConfig;
  url: UrlState;
  view: FacetView;
  scopeIds: readonly string[] | null;
  extra: readonly ExtraFacet[];
  defaultSort: SortKey;
  messages?: SearchMessages;
  indexUrl?: string;
  logUrl?: string;
  children: ReactNode;
}

function currentPath(qs: string): string {
  return window.location.pathname + (qs ? `?${qs}` : '');
}

/**
 * Client state for a faceted listing. First paint uses the server-computed view; /facets.json loads on
 * the first sign of intent and then every change is computed locally (bitsets, no network). URL is the
 * state: facet toggles push a history entry, range typing and "show more" replace it, back and forward
 * restore the selection (and the browser restores scroll).
 */
export function FacetProvider({ config, url: initialUrl, view: initialView, scopeIds, extra, defaultSort, messages = searchMessages, indexUrl = '/facets.json', logUrl = '/api/search/log', children }: FacetProviderProps) {
  const [url, setUrl] = useState(initialUrl);
  const [view, setView] = useState(initialView);
  const [loading, setLoading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const ixRef = useRef<LoadedIndex | null>(null);
  const loadRef = useRef<Promise<LoadedIndex | null> | null>(null);
  const logged = useRef(new Set<string>());

  const ensureIndex = useCallback((): Promise<LoadedIndex | null> => {
    loadRef.current ??= (async () => {
      setLoading(true);
      try {
        const res = await fetch(indexUrl);
        if (!res.ok) throw new Error(String(res.status));
        const ix = withExtraFacets(loadIndex((await res.json()) as SearchIndex), extra);
        ixRef.current = ix;
        return ix;
      } catch {
        loadRef.current = null; // retry on the next interaction
        return null;
      } finally {
        setLoading(false);
      }
    })();
    return loadRef.current;
  }, [indexUrl, extra]);

  const compute = useCallback(
    (ix: LoadedIndex, u: UrlState) => computeView(ix, config, u.state, { scope: scopeBits(ix, scopeIds), sort: u.sort, order: scopeIds ?? undefined }),
    [config, scopeIds],
  );

  const commit = useCallback(
    (next: UrlState, mode: 'push' | 'replace') => {
      setUrl(next);
      const qs = serializeUrlState(next, config, defaultSort);
      if (mode === 'push') window.history.pushState(null, '', currentPath(qs));
      else window.history.replaceState(window.history.state, '', currentPath(qs));
      const ix = ixRef.current;
      if (ix) startTransition(() => setView(compute(ix, next)));
      else
        void ensureIndex().then((loaded) => {
          if (loaded) startTransition(() => setView(compute(loaded, next)));
        });
    },
    [config, defaultSort, compute, ensureIndex],
  );

  // Back / forward: the URL is the source of truth.
  useEffect(() => {
    const onPop = () => {
      const next = parseUrlState(new URLSearchParams(window.location.search), config, defaultSort);
      setUrl(next);
      void ensureIndex().then((ix) => {
        if (ix) startTransition(() => setView(compute(ix, next)));
      });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [config, defaultSort, compute, ensureIndex]);

  // Zero-result combinations are logged once each (search insights).
  useEffect(() => {
    if (view.total !== 0 || !view.chips.length) return;
    const filters = encodeFilters(url.state, config);
    const key = `${url.q}|${filters}`;
    if (logged.current.has(key)) return;
    logged.current.add(key);
    const body = JSON.stringify({ q: url.q, results: 0, filters });
    if (!navigator.sendBeacon?.(logUrl, new Blob([body], { type: 'application/json' }))) {
      void fetch(logUrl, { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => undefined);
    }
  }, [view, url, config, logUrl]);

  const rangeText = (key: string, min: number | null, max: number | null) => {
    const def = config.ranges.find((r) => r.key === key);
    const show = (v: number) => (def?.format === 'money' ? formatINR(asPaise(Math.round(v * def.scale))) : String(v));
    const f = messages.filters;
    if (min != null && max != null) return fmt(f.rangeBetween, { min: show(min), max: show(max) });
    if (max != null) return fmt(f.rangeUnder, { max: show(max) });
    return fmt(f.rangeOver, { min: show(min ?? 0) });
  };

  const value: FacetContextValue = {
    config,
    messages,
    url,
    view,
    defaultSort,
    pending: loading || isPending,
    apply: (state, sort) => commit({ ...url, state, sort: sort ?? url.sort, page: 1 }, 'push'),
    setRange: (key, range) => {
      const ranges = { ...url.state.ranges };
      if (!range || (range.min == null && range.max == null)) delete ranges[key];
      else ranges[key] = range;
      commit({ ...url, state: { ...url.state, ranges }, page: 1 }, 'replace');
    },
    setSort: (sort) => commit({ ...url, sort, page: 1 }, 'push'),
    showMore: () => {
      const next = { ...url, page: url.page + 1 };
      setUrl(next);
      window.history.replaceState(window.history.state, '', currentPath(serializeUrlState(next, config, defaultSort)));
    },
    preview: (state) => (ixRef.current ? compute(ixRef.current, { ...url, state }) : null),
    prefetch: () => void ensureIndex(),
    rangeText,
    rangeLabel: (chip) => `${messages.ranges[chip.key] ?? chip.key}: ${rangeText(chip.key, chip.min, chip.max)}`,
  };

  return <FacetContext value={value}>{children}</FacetContext>;
}
