import type { FacetIndex, FacetSourceRow } from '@ecomkit/core/contracts';
import { bitsFrom, encodeBits } from './bitset';

/** Text the suggest box matches, aligned with `ids`. Short keys: this ships to the browser. */
export interface SearchDoc {
  /** slug */
  s: string;
  /** kind (plant, input, ...) */
  k: string;
  /** name */
  n: string;
  /** local-language name */
  l?: string;
  /** scientific name */
  c?: string;
  /** aliases */
  a?: string[];
}

/** `/facets.json`: the frozen FacetIndex plus suggest text. */
export interface SearchIndex extends FacetIndex {
  docs: readonly SearchDoc[];
}

export interface SearchSourceRow extends FacetSourceRow {
  slug: string;
  kind: string;
  name: string;
  nameLocal?: string | null;
  scientificName?: string | null;
  aliases?: readonly string[] | null;
}

export interface IndexLabels {
  facets: Readonly<Record<string, string>>;
  values: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/** Marker value: products whose facet is known but has no displayable value (counts for the auto-hide rule). */
export const KNOWN = '_known';

const humanise = (v: string) => v.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/**
 * Builds the static index. Row order is kept (the source orders by recommendation), so position = rank.
 * Value bitsets are base64; a facet where some products are known but valueless gets a `_known` bitset.
 */
export function buildSearchIndex(rows: readonly SearchSourceRow[], labels: IndexLabels, now: Date = new Date()): SearchIndex {
  const n = rows.length;
  const valuePos = new Map<string, Map<string, number[]>>();
  const knownPos = new Map<string, number[]>();
  const numeric: Record<string, (number | null)[]> = {};
  rows.forEach((row, i) => {
    for (const [key, values] of Object.entries(row.facets)) {
      let byValue = valuePos.get(key);
      if (!byValue) valuePos.set(key, (byValue = new Map()));
      if (!knownPos.has(key)) knownPos.set(key, []);
      knownPos.get(key)!.push(i);
      for (const v of values) {
        let list = byValue.get(v);
        if (!list) byValue.set(v, (list = []));
        list.push(i);
      }
    }
    for (const [key, value] of Object.entries(row.numeric)) {
      (numeric[key] ??= new Array<number | null>(n).fill(null))[i] = value == null || !Number.isFinite(value) ? null : value;
    }
  });

  const facets: Record<string, { label: string; values: Record<string, { label: string; bits: string }> }> = {};
  for (const [key, byValue] of [...valuePos].sort(([a], [b]) => a.localeCompare(b))) {
    const values: Record<string, { label: string; bits: string }> = {};
    const union = new Set<number>();
    // Values in label order when the labels define one (rainfall low to high), else alphabetical.
    const order = Object.keys(labels.values[key] ?? {});
    const rank = (v: string) => (order.includes(v) ? order.indexOf(v) : order.length);
    for (const [v, pos] of [...byValue].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))) {
      values[v] = { label: labels.values[key]?.[v] ?? humanise(v), bits: encodeBits(bitsFrom(n, pos), n) };
      pos.forEach((p) => union.add(p));
    }
    const known = knownPos.get(key) ?? [];
    if (known.length > union.size) values[KNOWN] = { label: '', bits: encodeBits(bitsFrom(n, known), n) };
    facets[key] = { label: labels.facets[key] ?? humanise(key), values };
  }

  const docs = rows.map((r): SearchDoc => {
    const d: SearchDoc = { s: r.slug, k: r.kind, n: r.name };
    if (r.nameLocal) d.l = r.nameLocal;
    if (r.scientificName) d.c = r.scientificName;
    if (r.aliases?.length) d.a = [...r.aliases];
    return d;
  });

  return { version: 1, generatedAt: now.toISOString(), ids: rows.map((r) => r.productId), facets, numeric, docs };
}
