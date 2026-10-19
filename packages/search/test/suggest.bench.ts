// Vitest bench (`pnpm -F @ecomkit/search bench`): 200 suggest queries over 350 products.
// The gated p95 < 80 ms assertion runs in suggest.test.ts with `pnpm test`; this file reports the distribution.
import { expect, test } from 'vitest';
import { buildSearchIndex, prepareSuggest, suggest } from '../src/domain';
import { searchMessages } from '../src/messages';
import { syntheticRows } from './fixtures';

const index = buildSearchIndex(syntheticRows(350), { facets: searchMessages.facets, values: searchMessages.values });
const sx = prepareSuggest(index.ids, index.docs);
const base = ['mang', 'mahagony', 'ಮಾವು', 'tectona', 'chikku', 'red san', 'xyzzy', 'golden mango', 'jakfruit', 'neem'];
const queries = Array.from({ length: 200 }, (_, i) => base[i % base.length]!);

test('suggest, 350 products, 200 queries', async ({ bench }) => {
  let i = 0;
  const result = await bench('suggest', () => void suggest(sx, queries[i++ % queries.length]!, 8)).run({ iterations: 200 });
  console.info(`suggest per query: mean ${result.latency.mean.toFixed(3)} ms, p99 ${result.latency.p99.toFixed(3)} ms`);
  expect(result.latency.p99).toBeLessThan(80);
});
