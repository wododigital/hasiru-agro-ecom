import { describe, expect, it } from 'vitest';
import { buildSearchIndex, editDistance, normalise, prepareSuggest, suggest } from '../src/domain';
import { searchMessages } from '../src/messages';
import { suggestHandler } from '../src/server/handlers';
import { syntheticRows } from './fixtures';

const index = buildSearchIndex(syntheticRows(350), { facets: searchMessages.facets, values: searchMessages.values });
const sx = prepareSuggest(index.ids, index.docs);
const names = (q: string) => suggest(sx, q, 8).map((s) => s.name);

describe('suggest over the index', () => {
  it('matches English names by prefix, base names first', () => {
    expect(names('mang')[0]).toBe('Mango');
    expect(names('mang').every((n) => n.startsWith('Mango'))).toBe(true);
  });
  it('matches local-language (Kannada) names', () => {
    const hits = suggest(sx, 'ಮಾವು');
    expect(hits[0]!.name).toBe('Mango');
    expect(hits[0]!.matched).toBe('local');
  });
  it('matches scientific names', () => {
    expect(names('tectona')[0]).toBe('Teak');
    expect(suggest(sx, 'Tectona grandis')[0]!.matched).toBe('scientific');
  });
  it('matches romanised aliases and reports which alias matched', () => {
    const hit = suggest(sx, 'chikku')[0]!;
    expect(hit.name).toBe('Sapota');
    expect(hit).toMatchObject({ matched: 'alias', matchedText: 'chikku' });
  });
  it('tolerates typos from 4 characters', () => {
    expect(names('mahogani')[0]).toMatch(/^Mahogany/);
    expect(names('jakfruit')[0]).toMatch(/^Jackfruit/);
    expect(names('xq')).toEqual([]);
  });
  it('needs every token to match', () => {
    expect(names('red sand')[0]).toBe('Red Sandalwood');
    expect(names('mango teak')).toEqual([]);
  });
  it('normalises case, accents and punctuation', () => {
    expect(normalise('  Máñgo-Tree! ')).toBe('mango tree');
    expect(editDistance('mahagony', 'mahogany', 2)).toBe(2);
    expect(editDistance('abcdef', 'uvwxyz', 2)).toBe(3);
  });
});

describe('suggest latency', () => {
  // 200 realistic queries: prefixes, Kannada, scientific, aliases and typos.
  const base = ['ma', 'man', 'mang', 'teak', 'tea', 'maho', 'mahagony', 'sapo', 'chikku', 'jack', 'ಹಲಸು', 'ಮಾ', 'tectona', 'psidium', 'red san', 'coco', 'neem c', 'jamun', 'avocad', 'peppr', 'drumstik', 'silver', 'tamarind', 'amla', 'adike', 'lemon', 'pomegranite', 'cashew', 'vermi', 'biochar', 'gauva', 'moringa', 'butter fruit', 'java plum', 'hunase', 'nellikai', 'xyzzy', 'sweet', 'golden mango', 'dwarf'];
  const queries = Array.from({ length: 200 }, (_, i) => base[i % base.length]!);

  it('p95 under 80 ms over 350 products through the HTTP handler (200 queries)', async () => {
    const GET = suggestHandler(async () => index);
    await GET(new Request('http://x/api/search/suggest?q=warm')); // warm the prepared index
    const times: number[] = [];
    for (const q of queries) {
      const t0 = performance.now();
      const res = await GET(new Request(`http://x/api/search/suggest?q=${encodeURIComponent(q)}`));
      await res.json();
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)]!;
    console.info(`suggest p95 ${p95.toFixed(2)} ms, max ${times.at(-1)!.toFixed(2)} ms`);
    expect(p95).toBeLessThan(80);
  });

  it('validates the query (zod): too short or too long returns no items, not an error', async () => {
    const GET = suggestHandler(async () => index);
    expect(await (await GET(new Request('http://x/api/search/suggest?q=m'))).json()).toEqual({ items: [] });
    expect(await (await GET(new Request(`http://x/api/search/suggest?q=${'m'.repeat(81)}`))).json()).toEqual({ items: [] });
    const res = await GET(new Request('http://x/api/search/suggest?q=teak&limit=2'));
    expect(res.headers.get('cache-control')).toContain('public');
    expect(((await res.json()) as { items: unknown[] }).items).toHaveLength(2);
  });
});
