import type { ParsedQuestion } from './intent';
import { normalise, singular } from './intent';
import type { CatalogItem, NoteKey, ProductFact, StockState } from './types';

/** Most products an answer names (the card rail shows up to 8; the text stays short). */
export const MAX_PRODUCTS = 6;
/** Candidates enriched with price and stock before the final cut. */
export const MAX_CANDIDATES = 200;
export const SQFT_PER_ACRE = 43_560;

const words = (s: string | null | undefined): string[] => (s ? normalise(s).split(' ').map(singular) : []);

export interface Candidate {
  item: CatalogItem;
  /** Distinct question terms this item matched. */
  matched: number;
  /** Tie-break inside the same `matched` tier: name hits weigh more than category hits. */
  weight: number;
}

/**
 * Text retrieval and hard attribute filters. Terms match product names first, then categories and tags; only the
 * best tier (most distinct terms matched) is kept, so "timber trees" does not return every tree. When no term
 * matches, the whole filtered pool comes back and `best` is 0 (the caller decides between a list and "no match").
 */
export function selectCandidates(q: ParsedQuestion, items: readonly CatalogItem[]): { candidates: Candidate[]; best: number } {
  let pool = items.filter((i) => i.status === 'active' && i.availabilityOverride !== 'hidden');
  if (q.intents.includes('shade')) pool = pool.filter((i) => i.exposure === 'partial_shade' || i.exposure === 'shade');
  if (q.intents.includes('nitrogen')) pool = pool.filter((i) => i.nitrogenFixer);
  if (q.bearingWithinYears != null) pool = pool.filter((i) => i.bearingYearsMin != null && i.bearingYearsMin <= q.bearingWithinYears!);

  const scored = pool.map((item): Candidate => {
    const name = new Set([...words(item.name), ...words(item.nameKn), ...words(item.slug.replace(/-/g, ' '))]);
    const groups = new Set(item.groups.flatMap((g) => words(g.replace(/-/g, ' '))));
    let matched = 0;
    let weight = 0;
    for (const t of q.terms) {
      if (name.has(t)) {
        matched += 1;
        weight += 2;
      } else if (groups.has(t)) {
        matched += 1;
        weight += 1;
      }
    }
    return { item, matched, weight };
  });

  const best = Math.max(0, ...scored.map((c) => c.matched));
  const candidates = best > 0 ? scored.filter((c) => c.matched === best) : scored;
  candidates.sort((a, b) => b.weight - a.weight || Number(b.item.isBestSeller) - Number(a.item.isBestSeller) || a.item.name.localeCompare(b.item.name));
  return { candidates: candidates.slice(0, MAX_CANDIDATES), best };
}

const POLICY = ['bulk', 'delivery', 'returns'] as const;
const hasAttributeFilter = (q: ParsedQuestion): boolean =>
  q.intents.includes('shade') || q.intents.includes('nitrogen') || q.bearingWithinYears != null || q.maxPricePaise != null || q.intents.includes('stock');

/**
 * Whether the answer lists products, and whether it says "no match". A policy question ("how does bulk pricing
 * work?") gets the policy note only; a named thing the catalogue does not have gets "no match"; attribute
 * questions ("what grows in shade?") list the filtered catalogue even when no name matched.
 */
export function listDecision(q: ParsedQuestion, best: number): { list: boolean; noMatch: boolean } {
  if (q.intents.includes('offTopic')) return { list: false, noMatch: false };
  if (q.intents.length === 1 && q.intents[0] === 'greeting' && !q.terms.length) return { list: false, noMatch: false };
  if (best > 0 || hasAttributeFilter(q) || q.intents.includes('fit') || q.intents.includes('companions') || q.intents.includes('acreage')) return { list: true, noMatch: false };
  if (q.intents.some((i) => (POLICY as readonly string[]).includes(i))) return { list: false, noMatch: false };
  return q.terms.length ? { list: false, noMatch: true } : { list: true, noMatch: false };
}

const STOCK_ORDER: Record<StockState, number> = { in_stock: 0, low_stock: 0, preorder: 1, unknown: 2, out_of_stock: 3 };
const FIT_ORDER = { good: 0, ok: 1, not_recommended: 3 } as const;

/**
 * Price and stock filters (they need live data), then the final order: in stock first, better district fit,
 * then retrieval weight, then best sellers.
 */
export function rankProducts(q: ParsedQuestion, products: readonly ProductFact[], weights: ReadonlyMap<string, number>, limit = MAX_PRODUCTS): ProductFact[] {
  let list = [...products];
  if (q.maxPricePaise != null) list = list.filter((p) => p.unitPaise != null && Math.min(p.unitPaise, p.bulk?.unitPaise ?? p.unitPaise) <= q.maxPricePaise!);
  if (q.intents.includes('stock')) list = list.filter((p) => p.stock !== 'out_of_stock');
  if (q.intents.includes('fit')) list = list.filter((p) => p.fit !== 'not_recommended');
  list.sort(
    (a, b) =>
      STOCK_ORDER[a.stock] - STOCK_ORDER[b.stock] ||
      (a.fit ? FIT_ORDER[a.fit] : 2) - (b.fit ? FIT_ORDER[b.fit] : 2) ||
      (weights.get(b.id) ?? 0) - (weights.get(a.id) ?? 0) ||
      a.name.localeCompare(b.name),
  );
  return list.slice(0, limit);
}

/** Plants for an area at a spacing: rectangular grid, rounded to the nearest whole plant. */
export function qtyForArea(acres: number, spacingFt: readonly [number, number] | number): number | null {
  const [l, w] = typeof spacingFt === 'number' ? [spacingFt, spacingFt] : spacingFt;
  if (!(l > 0 && w > 0 && acres > 0)) return null;
  return Math.round((acres * SQFT_PER_ACRE) / (l * w));
}

/** Canned notes the answer carries alongside (or instead of) products. */
export function notesFor(q: ParsedQuestion, ctx: { products: number; noMatch: boolean; companionsMissing: boolean }): NoteKey[] {
  if (q.intents.includes('offTopic')) return ['offTopic'];
  if (q.intents.length === 1 && q.intents[0] === 'greeting' && !q.terms.length) return ['greeting'];
  const notes: NoteKey[] = [];
  for (const i of POLICY) if (q.intents.includes(i)) notes.push(i);
  if (q.intents.includes('acreage')) notes.push('acreage');
  if (ctx.companionsMissing) notes.push('companionsUnavailable');
  if (ctx.noMatch || (!ctx.products && !notes.length)) notes.push('noMatch');
  return notes;
}
