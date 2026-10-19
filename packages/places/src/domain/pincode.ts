// India Post pincode directory -> one row per pincode with our district slug. Pure functions.
import { fold } from './search';

export interface DistrictKey {
  slug: string;
  name: string;
  stateCode: string;
  aliases: readonly string[];
}

export function levenshtein(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]!);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

export interface DistrictMatcher {
  match(rawDistrict: string, stateCode: string): { slug: string; how: 'exact' | 'fuzzy' } | null;
}

const NOISE = /\b(district|dist|urban|rural|city)\b/g;

/**
 * Matches the spelling India Post uses (upper case, old names, "BANGALORE") to a district in the same state:
 * exact on name or alias, then the same ignoring "district/urban/rural", then edit distance <= 2 (<= 3 over 10 letters).
 * Anything else is null: a blank district is better than a wrong one.
 */
export function buildDistrictMatcher(districts: readonly DistrictKey[]): DistrictMatcher {
  const byState = new Map<string, { slug: string; terms: string[]; loose: string[] }[]>();
  for (const d of districts) {
    const terms = [d.name, ...d.aliases].map(fold).filter(Boolean);
    const loose = terms.map((t) => t.replace(NOISE, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    const list = byState.get(d.stateCode) ?? [];
    list.push({ slug: d.slug, terms, loose });
    byState.set(d.stateCode, list);
  }
  return {
    match(raw, stateCode) {
      const list = byState.get(stateCode);
      const q = fold(raw);
      if (!list || !q) return null;
      const exact = list.find((d) => d.terms.includes(q));
      if (exact) return { slug: exact.slug, how: 'exact' };
      const ql = q.replace(NOISE, '').replace(/\s+/g, ' ').trim();
      const looseHit = ql ? list.find((d) => d.loose.includes(ql)) : undefined;
      if (looseHit) return { slug: looseHit.slug, how: 'exact' };
      const max = q.length > 10 ? 3 : 2;
      let best: { slug: string; dist: number } | null = null;
      let tie = false;
      for (const d of list) {
        const dist = Math.min(...d.terms.map((t) => levenshtein(q, t, max)));
        if (dist <= max && (!best || dist < best.dist)) {
          best = { slug: d.slug, dist };
          tie = false;
        } else if (dist <= max && best && dist === best.dist && d.slug !== best.slug) tie = true;
      }
      return best && !tie ? { slug: best.slug, how: 'fuzzy' } : null;
    },
  };
}

export const OFFICE_RANK: Record<string, number> = { HO: 0, PO: 1, BO: 2 };

/** "Kothimir B.O" -> "Kothimir"; keeps the office's own capitalisation otherwise. */
export function cleanOfficeName(name: string): string {
  return name
    .replace(/\s+(B\.?O|S\.?O|H\.?O|G\.?P\.?O)\.?$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Minimal RFC 4180 line parser (quoted fields, doubled quotes). The directory has no embedded newlines. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
