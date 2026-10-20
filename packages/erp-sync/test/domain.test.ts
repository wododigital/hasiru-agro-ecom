import { describe, expect, it } from 'vitest';
import { backoffMs, csvLine, erpInventoryPageSchema, normaliseName, proposeMatches, similarity, statusCallbackSchema } from '../src/domain';

describe('name matching', () => {
  it('normalises case, punctuation and spacing', () => {
    expect(normaliseName('Mango (Alphonso)', ' Grafted ')).toBe('mango alphonso grafted');
  });

  it('scores identical names 1 and unrelated names low', () => {
    expect(similarity('mango alphonso', 'mango alphonso')).toBe(1);
    expect(similarity('mango alphonso', 'teak')).toBeLessThan(0.2);
    expect(similarity('mango alphonso', 'mango alphonsa')).toBeGreaterThanOrEqual(0.8);
  });

  it('exact SKU wins with confidence 1, then name similarity, one to one, strongest pair first', () => {
    const candidates = [
      { variantId: 'va', sku: 'MNG-ALP', name: 'Mango', variety: 'Alphonso' },
      { variantId: 'vb', sku: null, name: 'Mango', variety: 'Banganapalli' },
      { variantId: 'vc', sku: null, name: 'Jackfruit', variety: null },
    ];
    const out = proposeMatches(
      [
        { erpItemId: 'e1', sku: 'mng-alp', name: 'Something else', variety: null },
        { erpItemId: 'e2', sku: null, name: 'Mango', variety: 'Banganapalli' },
        { erpItemId: 'e3', sku: null, name: 'Mango', variety: 'Banganapalli 2ft' },
        { erpItemId: 'e4', sku: null, name: 'Jack fruit', variety: null },
      ],
      candidates,
    );
    const by = Object.fromEntries(out.map((p) => [p.erpItemId, p]));
    expect(by.e1).toMatchObject({ variantId: 'va', confidence: 1, via: 'sku' });
    expect(by.e2).toMatchObject({ variantId: 'vb', confidence: 1 });
    // vb is taken by the exact match, so e3 cannot claim it.
    expect(by.e3?.variantId).not.toBe('vb');
    expect(by.e4?.variantId).toBe('vc');
    expect(new Set(out.map((p) => p.variantId)).size).toBe(out.length);
  });
});

describe('backoff', () => {
  it('doubles from 30 s and caps at an hour', () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([30_000, 60_000, 120_000, 240_000]);
    expect(backoffMs(30)).toBe(3_600_000);
  });
});

describe('csv', () => {
  it('quotes and neutralises formula cells', () => {
    expect(csvLine(['a,b', 'say "hi"', '=SUM(A1)', -5, null])).toBe('"a,b","say ""hi""",\'=SUM(A1),-5,');
  });
});

describe('boundary schemas', () => {
  it('floors fractional and negative stock from the ERP', () => {
    const page = erpInventoryPageSchema.parse({
      items: [{ erpItemId: 'x', sku: null, name: 'Teak', variety: null, available: -3.5, readyInDays: null, costPaise: null, updatedAt: '2026-10-20T00:00:00Z' }],
      nextCursor: null,
    });
    expect(page.items[0]!.available).toBe(0);
  });

  it('rejects statuses the ERP does not own', () => {
    expect(statusCallbackSchema.safeParse({ ecomOrderNumber: 'X-1', status: 'refunded' }).success).toBe(false);
    expect(statusCallbackSchema.safeParse({ ecomOrderNumber: 'X-1', status: 'dispatched' }).success).toBe(true);
  });
});
