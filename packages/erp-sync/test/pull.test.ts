import { newId } from '@ecomkit/core/ids';
import { setSettings } from '@ecomkit/core/settings';
import type { TestDb } from '@ecomkit/core/testing';
import { getLevel, seedLevels, setLevel } from '@ecomkit/inventory/server';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { erpItem, erpItemMap, erpSyncRun } from '../src/schema';
import { configureErpSync, driftCsvRows, erpItemIdsFor, driftReport, erpSyncSettings, mappingOverview, mapSku, MappingError, pullAgeHealth, pullInventory, unmapSku } from '../src/server';
import { erpDb, events, fakeAdapter, item, type FakeAdapter } from './helpers';

let t: TestDb;
let erp: FakeAdapter;

/** A catalogue variant with an inventory level; the candidate list the catalog port would return. */
const variants: { variantId: string; productId: string; sku: string; name: string; variety: string | null }[] = [];
async function variant(name: string, variety: string | null, onHand = 0) {
  const v = { variantId: newId(), productId: newId(), sku: `V-${variants.length + 1}`, name, variety };
  variants.push(v);
  await seedLevels([{ variantId: v.variantId, productId: v.productId, sku: v.sku, onHand }]);
  return v;
}

beforeAll(async () => {
  t = await erpDb('pull');
});
afterAll(async () => {
  await t?.close();
});
beforeEach(async () => {
  await t.db.execute(sql`truncate erp_item, erp_item_map, erp_sync_run`);
  erp = fakeAdapter();
  configureErpSync({ adapter: async () => erp, variantCandidates: async () => variants.map(({ productId: _p, ...c }) => c) });
  await setSettings(erpSyncSettings, { enabled: true, pullEveryMinutes: 10, autoMapMinConfidence: 0.8 }, { actorId: null });
});

describe('pull', () => {
  it('pages past 1000 items with the keyset cursor and snapshots every item', async () => {
    erp.items = Array.from({ length: 2345 }, (_, i) => item(i + 1));
    const r = await pullInventory({ force: true });
    expect(r).toMatchObject({ status: 'done', items: 2345 });
    expect(erp.pulls).toEqual([null, 'item-01000', 'item-02000']);
    const [{ n }] = (await t.db.execute<{ n: number }>(sql`select count(*)::int as n from erp_item`)).rows as [{ n: number }];
    expect(n).toBe(2345);
    const [run] = await t.db.select().from(erpSyncRun);
    expect(run).toMatchObject({ direction: 'inventory_in', transport: 'fake', items: 2345, errors: 0 });
    expect((await events(t, 'erp.synced')).some((e) => e.payload.kind === 'inventory')).toBe(true);
  });

  it('auto-maps confident matches, updates stock, leaves manual overrides alone and zeroes items the ERP dropped', async () => {
    const mango = await variant('Mango', 'Alphonso', 5);
    const jack = await variant('Jackfruit', 'Red', 5);
    const teak = await variant('Teak', null, 7);
    const gone = await variant('Sapota', 'Cricket Ball', 9);
    // Admin counted the jackfruit: manual override (A26).
    await setLevel({ variantId: jack.variantId, productId: jack.productId, onHand: 40 }, null);
    await t.db.insert(erpItemMap).values({ variantId: gone.variantId, erpItemId: 'ops-gone', erpName: 'Sapota', mappedBy: 'manual', confidence: 1 });
    await t.db.insert(erpItem).values({ erpItemId: 'ops-gone', name: 'Sapota', available: 9 });
    erp.items = [
      item(1, { erpItemId: 'ops-mango', name: 'Mango', variety: 'Alphonso', available: 12 }),
      item(2, { erpItemId: 'ops-jack', name: 'Jackfruit', variety: 'Red', available: 3 }),
      item(3, { erpItemId: 'ops-teak', name: 'Tiikki', variety: 'Something', available: 50 }),
      item(4, { erpItemId: 'ops-guava', name: 'Guava', variety: null, available: 0, readyInDays: 45 }),
    ];
    const r = await pullInventory({ force: true });
    expect(r).toMatchObject({ status: 'done', autoMapped: 2, unmapped: 2, skippedManual: 1, zeroed: 1 });
    expect((await getLevel(mango.variantId))).toMatchObject({ onHand: 12, source: 'erp' });
    expect((await getLevel(jack.variantId))).toMatchObject({ onHand: 40, source: 'manual', erpOnHand: 3 });
    expect((await getLevel(teak.variantId))).toMatchObject({ onHand: 7, source: 'seed' });
    expect((await getLevel(gone.variantId))?.onHand).toBe(0);

    // Drift: the manual row (ours 40 vs ERP 3) is listed and flagged.
    const drift = await driftReport();
    expect(drift.find((d) => d.variantId === jack.variantId)).toMatchObject({ ourOnHand: 40, erpAvailable: 3, diff: 37, manualOverride: true });
    expect(drift.find((d) => d.variantId === mango.variantId)).toBeUndefined();
    expect((await driftCsvRows()).rows[0]).toContain('manual_override');

    // Low-confidence and unknown items wait for an admin, with a suggestion where there is one.
    const overview = await mappingOverview();
    expect(overview.unmapped.map((u) => u.erpItemId).sort()).toEqual(['ops-guava', 'ops-teak']);
    expect(overview.mapped.find((m) => m.variantId === mango.variantId)).toMatchObject({ mappedBy: 'auto', confidence: 1 });
    expect(await erpItemIdsFor([mango.variantId, teak.variantId])).toEqual({ [mango.variantId]: 'ops-mango' });

    // Admin links teak by hand; the next pull carries its stock.
    const actor = newId();
    await mapSku({ variantId: teak.variantId, erpItemId: 'ops-teak' }, actor);
    await pullInventory({ force: true });
    expect((await getLevel(teak.variantId))?.onHand).toBe(50);
    await expect(mapSku({ variantId: teak.variantId, erpItemId: 'never-seen' }, actor)).rejects.toBeInstanceOf(MappingError);
    expect(await unmapSku(teak.variantId, actor)).toBe(true);
    expect(await t.db.select().from(erpItemMap).where(eq(erpItemMap.variantId, teak.variantId))).toHaveLength(0);
  });

  it('a failed page records an errored run and changes no stock', async () => {
    const v = await variant('Coconut', 'Dwarf', 4);
    await t.db.insert(erpItemMap).values({ variantId: v.variantId, erpItemId: 'ops-coco', erpName: 'Coconut', mappedBy: 'manual', confidence: 1 });
    erp.failPulls = true;
    const r = await pullInventory({ force: true });
    expect(r).toMatchObject({ status: 'failed', error: 'ERP down', zeroed: 0 });
    expect((await getLevel(v.variantId))?.onHand).toBe(4);
    const [run] = await t.db.select().from(erpSyncRun);
    expect(run?.errors).toBe(1);
    expect(await pullAgeHealth()).toMatchObject({ status: 'degraded' });
  });

  it('respects the interval unless forced, and reports pull age', async () => {
    erp.items = [item(1)];
    const now = new Date();
    expect((await pullInventory({ now })).status).toBe('done');
    expect((await pullInventory({ now: new Date(now.getTime() + 60_000) })).status).toBe('not_due');
    expect((await pullInventory({ now: new Date(now.getTime() + 60_000), force: true })).status).toBe('done');
    expect((await pullInventory({ now: new Date(now.getTime() + 11 * 60_000) })).status).toBe('done');
    expect(await pullAgeHealth(now.getTime() + 12 * 60_000)).toMatchObject({ status: 'ok' });
    expect(await pullAgeHealth(now.getTime() + 60 * 60_000)).toMatchObject({ status: 'degraded' });
    configureErpSync({ adapter: null });
    expect((await pullInventory({ force: true })).status).toBe('not_configured');
    expect(await pullAgeHealth()).toMatchObject({ status: 'not_configured' });
  });

  it('falls back to inventory SKUs for matching when no catalog port is bound', async () => {
    configureErpSync({ variantCandidates: null });
    const v = await variant('ignored', null, 1);
    erp.items = [item(1, { erpItemId: 'ops-sku', sku: v.sku.toLowerCase(), available: 21 })];
    const r = await pullInventory({ force: true });
    expect(r.autoMapped).toBe(1);
    expect((await getLevel(v.variantId))?.onHand).toBe(21);
  });
});
