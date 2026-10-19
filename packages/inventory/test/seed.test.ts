import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId } from '@ecomkit/core/ids';
import type { SeedContext } from '@ecomkit/core/contracts';
import type { TestDb } from '@ecomkit/core/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getLevel } from '../src/server';
import { runSeed, seedHook, type VariantResolver } from '../src/server/seed';
import { inventoryDb, ledgerMismatches } from './helpers';

let t: TestDb;
let ctx: SeedContext;
const ids: Record<string, { variantId: string; productId: string }> = {};
const resolver: VariantResolver = async (skus) => Object.fromEntries(skus.filter((s) => ids[s]).map((s) => [s, ids[s]!]));

beforeAll(async () => {
  t = await inventoryDb('seed');
  const dir = await mkdtemp(join(tmpdir(), 'inventory-seed-'));
  const file = (records: unknown[]) => JSON.stringify({ version: 1, generated_at: '2026-10-20T10:00:00+05:30', sources: [], records });
  await writeFile(
    join(dir, 'products.json'),
    file([
      { sku: 'P-0001', variants: [{ stock_qty: 12, low_stock_threshold: 50 }, { sku: 'P-0001-02', stock_qty: 0, ready_in_days: 30 }] },
      { sku: 'P-0002', variants: [{ stock_qty: -4 }] },
    ]),
  );
  await writeFile(join(dir, 'inputs.json'), file([{ sku: 'I-001', variants: [{ stock_qty: 7 }] }]));
  for (const sku of ['P-0001-01', 'P-0001-02', 'I-001-01']) ids[sku] = { variantId: newId(), productId: newId() };
  ctx = { seedDir: dir, mediaDir: dir, dryRun: false, log: console };
});

afterAll(async () => {
  await t?.close();
});

describe('seed hook', () => {
  it('loads levels from products and inputs, reports unknown skus, and a second run changes nothing', async () => {
    const first = await runSeed(ctx, resolver);
    expect(first).toMatchObject({ inserted: 3, updated: 0, skipped: 1 });
    expect(first.notes?.[0]).toContain('P-0002-01');
    expect(await getLevel(ids['P-0001-01']!.variantId)).toMatchObject({ onHand: 12, lowStockThreshold: 50, source: 'seed', sku: 'P-0001-01' });
    expect(await getLevel(ids['P-0001-02']!.variantId)).toMatchObject({ availability: 'preorder', readyInDays: 30 });
    expect(await runSeed(ctx, resolver)).toMatchObject({ inserted: 0, updated: 0, skipped: 4 });
    expect(await ledgerMismatches(t)).toEqual([]);
  });

  it('a dry run writes nothing', async () => {
    const before = await getLevel(ids['I-001-01']!.variantId);
    expect(await runSeed({ ...ctx, dryRun: true }, resolver)).toMatchObject({ inserted: 0, updated: 0 });
    expect(await getLevel(ids['I-001-01']!.variantId)).toEqual(before);
  });

  it('without the catalog resolver it skips with a note instead of failing', async () => {
    const r = await seedHook(ctx);
    expect(r.inserted + r.updated).toBe(0);
    expect(r.notes?.join(' ')).toMatch(/variantRefsBySku/);
  });
});
