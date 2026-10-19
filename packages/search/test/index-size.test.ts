import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FACET_CONFIG, EMPTY_STATE, buildSearchIndex, computeView, loadIndex } from '../src/domain';
import { searchMessages } from '../src/messages';
import { syntheticRows } from './fixtures';

describe('static facet index budget', () => {
  const index = buildSearchIndex(syntheticRows(350), { facets: searchMessages.facets, values: searchMessages.values });
  const json = JSON.stringify(index);

  it('is under 40 KB gzipped for 350 products (facets, numeric columns and suggest text)', () => {
    const gz = gzipSync(json, { level: 9 }).length;
    console.info(`facets.json for 350 products: ${json.length} B raw, ${gz} B gzip`);
    expect(gz).toBeLessThan(40 * 1024);
  });

  it('decodes and computes a full view in a few milliseconds', () => {
    const ix = loadIndex(JSON.parse(json));
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) computeView(ix, DEFAULT_FACET_CONFIG, { values: { size: ['large', 'medium'], stock: ['in'] }, ranges: { price: { min: 100, max: 900 } } });
    const per = (performance.now() - t0) / 50;
    expect(per).toBeLessThan(10);
    expect(computeView(ix, DEFAULT_FACET_CONFIG, EMPTY_STATE).total).toBe(350);
  });
});
