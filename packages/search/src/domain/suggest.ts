import type { SearchDoc } from './build-index';

/** Lowercase, Latin accents stripped, punctuation to spaces. Non-Latin scripts (Kannada) keep their marks. */
export function normalise(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .trim();
}

/** pg_trgm style trigrams of one word (padded with two spaces in front, one behind). */
export function trigrams(word: string): Set<string> {
  const w = `  ${word} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= w.length; i++) out.add(w.slice(i, i + 3));
  return out;
}

/** Levenshtein distance, giving up (returns max + 1) once it exceeds `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

function similarity(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

type Field = 'name' | 'local' | 'scientific' | 'alias';

interface Prepared {
  i: number;
  fields: { field: Field; text: string; raw: string; words: { w: string; tri: Set<string> }[] }[];
}

export interface SuggestIndex {
  docs: readonly SearchDoc[];
  ids: readonly string[];
  prepared: readonly Prepared[];
}

export function prepareSuggest(ids: readonly string[], docs: readonly SearchDoc[]): SuggestIndex {
  const prepared = docs.map((d, i): Prepared => {
    const raw: [Field, string][] = [['name', d.n], ...(d.l ? [['local', d.l] as [Field, string]] : []), ...(d.c ? [['scientific', d.c] as [Field, string]] : []), ...(d.a ?? []).map((a) => ['alias', a] as [Field, string])];
    return {
      i,
      fields: raw.map(([field, text]) => {
        const norm = normalise(text);
        return { field, text: norm, raw: text, words: norm.split(' ').filter(Boolean).map((w) => ({ w, tri: trigrams(w) })) };
      }),
    };
  });
  return { docs, ids, prepared };
}

export interface Suggestion {
  id: string;
  slug: string;
  kind: string;
  name: string;
  nameLocal: string | null;
  scientificName: string | null;
  /** Which text matched; `matchedText` is the alias or name the visitor typed towards. */
  matched: Field;
  matchedText: string;
  score: number;
}

const FIELD_BONUS: Record<Field, number> = { name: 6, local: 4, alias: 2, scientific: 0 };

/** Best score of one query token against one field: whole-field prefix > word prefix > substring > fuzzy. */
function tokenScore(token: string, tri: Set<string> | null, f: Prepared['fields'][number]): number {
  if (f.text.startsWith(token)) return 80;
  let best = 0;
  for (const { w, tri: wt } of f.words) {
    if (w.startsWith(token)) best = Math.max(best, 60);
    else if (w.includes(token)) best = Math.max(best, 40);
    else if (tri) {
      // Typos: trigram overlap, or a small edit distance to the word (or its prefix while still typing).
      const s = similarity(tri, wt);
      if (s >= 0.3) best = Math.max(best, Math.round(35 * s));
      const max = token.length >= 7 ? 2 : 1;
      const d = Math.min(editDistance(token, w, max), editDistance(token, w.slice(0, token.length), max));
      if (d <= max) best = Math.max(best, 30 - 5 * d);
    }
  }
  return best;
}

/**
 * Typeahead over the index text (English, local-language, scientific names and aliases).
 * Every query token must match one field; fuzzy matching (typos like "mahagony") from 4 characters.
 */
export function suggest(index: SuggestIndex, query: string, limit = 8): Suggestion[] {
  const tokens = normalise(query).split(' ').filter(Boolean).slice(0, 6);
  if (!tokens.length) return [];
  const tris = tokens.map((t) => (t.length >= 4 ? trigrams(t) : null));
  const phrase = tokens.join(' ');
  const hits: Suggestion[] = [];
  for (const p of index.prepared) {
    let best: { score: number; field: Prepared['fields'][number] } | null = null;
    for (const f of p.fields) {
      let total = 0;
      let ok = true;
      for (let t = 0; t < tokens.length; t++) {
        const s = tokenScore(tokens[t]!, tris[t]!, f);
        if (!s) {
          ok = false;
          break;
        }
        total += s;
      }
      if (!ok) continue;
      let score = total / tokens.length + FIELD_BONUS[f.field];
      if (f.text === phrase) score += 30;
      else if (f.text.startsWith(phrase)) score += 10;
      if (!best || score > best.score) best = { score, field: f };
    }
    if (best) {
      const d = index.docs[p.i]!;
      hits.push({
        id: index.ids[p.i]!,
        slug: d.s,
        kind: d.k,
        name: d.n,
        nameLocal: d.l ?? null,
        scientificName: d.c ?? null,
        matched: best.field.field,
        matchedText: best.field.raw,
        score: best.score,
      });
    }
  }
  // Ties keep index order (recommended first).
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
