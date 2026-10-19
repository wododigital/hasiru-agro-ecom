// In-memory typeahead over district names, aliases and state names (research section 9, use 1).
import type { DistrictRef, PlaceSuggestion } from '@ecomkit/core/contracts';

export const MIN_QUERY_LENGTH = 2;

/** Lowercase ascii letters and digits with single spaces. */
export function fold(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface SearchEntry {
  district: DistrictRef;
  aliases: readonly string[];
}

interface Indexed {
  entry: SearchEntry;
  name: string;
  aliases: { raw: string; folded: string }[];
  state: string;
}

export function buildIndex(entries: readonly SearchEntry[]): Indexed[] {
  return entries.map((entry) => ({
    entry,
    name: fold(entry.district.name),
    aliases: entry.aliases.map((raw) => ({ raw, folded: fold(raw) })),
    state: fold(entry.district.stateName),
  }));
}

/** Higher is better; 0 means no match. */
function score(q: string, it: Indexed): { score: number; alias: string | null } {
  if (it.name === q) return { score: 100, alias: null };
  const exactAlias = it.aliases.find((a) => a.folded === q);
  if (exactAlias) return { score: 95, alias: exactAlias.raw };
  if (it.name.startsWith(q)) return { score: 80, alias: null };
  const prefixAlias = it.aliases.find((a) => a.folded.startsWith(q));
  if (prefixAlias) return { score: 70, alias: prefixAlias.raw };
  if (it.name.split(' ').some((w) => w.startsWith(q))) return { score: 55, alias: null };
  const wordAlias = it.aliases.find((a) => a.folded.split(' ').some((w) => w.startsWith(q)));
  if (wordAlias) return { score: 50, alias: wordAlias.raw };
  if (it.state.startsWith(q)) return { score: 30, alias: null };
  if (it.name.includes(q)) return { score: 20, alias: null };
  return { score: 0, alias: null };
}

/**
 * Ranks districts for a query of at least two characters. Ties go to the nearer district to the nursery,
 * then alphabetically, so "bang" and "mys" put the obvious local answer first.
 */
export function suggestDistricts(index: readonly Indexed[], query: string, limit = 6): PlaceSuggestion[] {
  const q = fold(query);
  if (q.length < MIN_QUERY_LENGTH) return [];
  const hits: { it: Indexed; s: number; alias: string | null }[] = [];
  for (const it of index) {
    const r = score(q, it);
    if (r.score > 0) hits.push({ it, s: r.score, alias: r.alias });
  }
  hits.sort(
    (a, b) =>
      b.s - a.s ||
      (a.it.entry.district.distanceKm ?? 1e9) - (b.it.entry.district.distanceKm ?? 1e9) ||
      a.it.entry.district.name.localeCompare(b.it.entry.district.name),
  );
  return hits.slice(0, Math.max(1, Math.min(limit, 20))).map(({ it, alias }) => ({
    kind: alias ? ('alias' as const) : ('district' as const),
    label: `${it.entry.district.name}, ${it.entry.district.stateName}`,
    district: it.entry.district,
  }));
}

/** Six digits, not starting with 0. */
export const PINCODE_RE = /^[1-9]\d{5}$/;
