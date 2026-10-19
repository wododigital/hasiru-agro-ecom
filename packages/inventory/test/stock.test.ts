import { newId } from '@ecomkit/core/ids';
import { withTx } from '@ecomkit/core/db';
import { setSettings } from '@ecomkit/core/settings';
import { TEST_NOW, type TestDb } from '@ecomkit/core/testing';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inventoryLevel, inventoryMovement, inventoryReservation } from '../src/schema';
import {
  adjust,
  clearOverride,
  commit,
  getLevel,
  getStock,
  getStocks,
  inventoryOps,
  inventorySettings,
  listLevels,
  release,
  releaseExpired,
  reserve,
  ReservationError,
  seedLevels,
  setFromErp,
  setLevel,
  StockError,
  updateLevelSettings,
} from '../src/server';
import { inventoryDb, ledgerMismatches, makeLevel, outboxEvents } from './helpers';

let t: TestDb;
const at = (sec: number) => new Date(TEST_NOW.getTime() + sec * 1000);

beforeAll(async () => {
  t = await inventoryDb('stock');
});

afterAll(async () => {
  await t?.close();
});

describe('availability', () => {
  it('derives sellable stock, preorder and out of stock from the level', async () => {
    const inStock = await makeLevel(8, { lowStockThreshold: 10 });
    const preorder = await makeLevel(0, { readyInDays: 30 });
    const out = await makeLevel(0);
    const s = await getStocks([inStock.variantId, preorder.variantId, out.variantId, newId()]);
    expect(s[inStock.variantId]).toMatchObject({ available: 8, availability: 'in_stock', lowStock: true });
    expect(s[preorder.variantId]).toMatchObject({ available: 0, availability: 'preorder', readyInDays: 30 });
    expect(s[out.variantId]).toMatchObject({ available: 0, availability: 'out_of_stock', lowStock: false });
    expect(Object.keys(s)).toHaveLength(3);
    expect(await getStock(newId())).toBeNull();
  });

  it('available is on_hand minus active reservations', async () => {
    const v = await makeLevel(5);
    await reserve([{ variantId: v.variantId, qty: 3 }], { ttlSec: 900, reference: 'attempt-1' });
    expect(await getStock(v.variantId)).toMatchObject({ onHand: 5, reserved: 3, available: 2, availability: 'in_stock' });
  });
});

describe('reservations', () => {
  it('concurrent reservations never oversell (25 parallel transactions on 10 units)', async () => {
    const v = await makeLevel(10);
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) => withTx((tx) => reserve([{ variantId: v.variantId, qty: 1 }], { ttlSec: 900, reference: `p-${i}`, tx }))),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(10);
    expect(results.filter((r) => !r.ok)).toHaveLength(15);
    const [level] = await t.db.select().from(inventoryLevel).where(eq(inventoryLevel.variantId, v.variantId));
    expect(level).toMatchObject({ onHand: 10, reserved: 10 });
    const [held] = await t.db.select({ n: sql<number>`sum(qty)::int` }).from(inventoryReservation).where(eq(inventoryReservation.variantId, v.variantId));
    expect(held?.n).toBe(10);
  });

  it('multi-line reservations in opposite line order neither deadlock nor oversell', async () => {
    const a = await makeLevel(6);
    const b = await makeLevel(6);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        inventoryOps.reserve(
          i % 2 ? [{ variantId: a.variantId, qty: 1 }, { variantId: b.variantId, qty: 1 }] : [{ variantId: b.variantId, qty: 1 }, { variantId: a.variantId, qty: 1 }],
          { ttlSec: 900, reference: `m-${i}` },
        ),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(6);
    const s = await getStocks([a.variantId, b.variantId]);
    expect(s[a.variantId]?.available).toBe(0);
    expect(s[b.variantId]?.available).toBe(0);
  });

  it('a shortage on one line reserves nothing and reports every short line', async () => {
    const a = await makeLevel(5);
    const b = await makeLevel(1);
    const missing = newId();
    const r = await reserve(
      [
        { variantId: a.variantId, qty: 2 },
        { variantId: b.variantId, qty: 3 },
        { variantId: missing, qty: 1 },
      ],
      { ttlSec: 900, reference: 'short' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.shortages).toEqual(expect.arrayContaining([{ variantId: b.variantId, requested: 3, available: 1 }, { variantId: missing, requested: 1, available: 0 }]));
    expect((await getStock(a.variantId))?.reserved).toBe(0);
  });

  it("a hold made in the caller's transaction disappears when that transaction rolls back", async () => {
    const v = await makeLevel(4);
    await expect(
      withTx(async (tx) => {
        const r = await reserve([{ variantId: v.variantId, qty: 4 }], { ttlSec: 900, reference: 'rollback', tx });
        expect(r.ok).toBe(true);
        throw new Error('order insert failed');
      }),
    ).rejects.toThrow('order insert failed');
    expect(await getStock(v.variantId)).toMatchObject({ reserved: 0, available: 4 });
  });

  it('commit moves the held quantity out of stock, writes the ledger and is idempotent', async () => {
    const v = await makeLevel(10);
    const r = await reserve([{ variantId: v.variantId, qty: 4 }], { ttlSec: 900, reference: 'order-1' });
    if (!r.ok) throw new Error('expected a reservation');
    await commit(r.reservation.reservationId);
    await commit(r.reservation.reservationId);
    expect(await getStock(v.variantId)).toMatchObject({ onHand: 6, reserved: 0, available: 6 });
    const moves = await t.db.select().from(inventoryMovement).where(eq(inventoryMovement.variantId, v.variantId));
    expect(moves.map((m) => [m.reason, m.delta, m.ref])).toEqual([
      ['seed', 10, null],
      ['order', -4, 'order-1'],
    ]);
    await expect(commit(newId())).rejects.toMatchObject({ code: 'not_found' });
  });

  it('release returns the hold; releasing twice or after commit changes nothing', async () => {
    const v = await makeLevel(3);
    const r = await reserve([{ variantId: v.variantId, qty: 3 }], { ttlSec: 900, reference: 'cart-9' });
    if (!r.ok) throw new Error('expected a reservation');
    await release(r.reservation.reservationId);
    await release(r.reservation.reservationId);
    expect(await getStock(v.variantId)).toMatchObject({ reserved: 0, available: 3 });
    await expect(commit(r.reservation.reservationId)).rejects.toBeInstanceOf(ReservationError);
  });
});

describe('TTL sweep', () => {
  it('releases holds only after expires_at, and a late commit then fails', async () => {
    const v = await makeLevel(5);
    const r = await reserve([{ variantId: v.variantId, qty: 2 }], { ttlSec: 900, reference: 'attempt-ttl', now: TEST_NOW });
    if (!r.ok) throw new Error('expected a reservation');
    expect(r.reservation.expiresAt.toISOString()).toBe(at(900).toISOString());

    // Other files' holds may exist in this database; count only ours.
    const ours = async () => (await t.db.select().from(inventoryReservation).where(eq(inventoryReservation.id, r.reservation.reservationId)))[0]?.status;
    await releaseExpired({ now: at(899) });
    expect(await ours()).toBe('held');
    expect((await getStock(v.variantId))?.available).toBe(3);

    expect(await releaseExpired({ now: at(901) })).toBeGreaterThanOrEqual(1);
    expect(await ours()).toBe('released');
    expect(await getStock(v.variantId)).toMatchObject({ reserved: 0, available: 5 });
    await expect(commit(r.reservation.reservationId)).rejects.toMatchObject({ code: 'released' });
  });
});

describe('ERP pull and manual override (A26)', () => {
  it('ERP pull does not touch manual rows, records the ERP number, and clearOverride hands the row back', async () => {
    const erpRow = await makeLevel(10);
    const manualRow = await makeLevel(10);
    await setLevel({ variantId: manualRow.variantId, productId: manualRow.productId, onHand: 7, note: 'recount' }, newId());

    const res = await setFromErp(
      [
        { variantId: erpRow.variantId, onHand: 20, readyInDays: null },
        { variantId: manualRow.variantId, onHand: 50 },
        { variantId: newId(), onHand: 1 },
      ],
      { now: TEST_NOW },
    );
    expect(res).toMatchObject({ changed: 1, skippedManual: 1 });
    expect(res.missing).toHaveLength(1);
    expect(await getLevel(erpRow.variantId)).toMatchObject({ onHand: 20, source: 'erp', erpOnHand: 20 });
    expect(await getLevel(manualRow.variantId)).toMatchObject({ onHand: 7, source: 'manual', erpOnHand: 50 });

    await clearOverride(manualRow.variantId, newId());
    expect(await getLevel(manualRow.variantId)).toMatchObject({ onHand: 50, source: 'erp' });
    await setFromErp([{ variantId: manualRow.variantId, onHand: 45 }], { now: at(60) });
    expect((await getLevel(manualRow.variantId))?.onHand).toBe(45);
  });

  it('ignores an ERP item older than the last one applied and clamps negatives to zero', async () => {
    const v = await makeLevel(10);
    await setFromErp([{ variantId: v.variantId, onHand: 12, updatedAt: at(100) }]);
    expect((await setFromErp([{ variantId: v.variantId, onHand: 3, updatedAt: at(50) }])).stale).toBe(1);
    expect((await getLevel(v.variantId))?.onHand).toBe(12);
    await setFromErp([{ variantId: v.variantId, onHand: -4, updatedAt: at(200) }]);
    expect((await getLevel(v.variantId))?.onHand).toBe(0);
  });

  it('a second identical pull changes nothing', async () => {
    const v = await makeLevel(10);
    await setFromErp([{ variantId: v.variantId, onHand: 9 }], { now: at(10) });
    expect(await setFromErp([{ variantId: v.variantId, onHand: 9 }], { now: at(20) })).toMatchObject({ changed: 0, unchanged: 1 });
  });
});

describe('ledger', () => {
  it('sum of movements equals on_hand for every level after a mix of operations', async () => {
    const v = await makeLevel(30);
    const r = await reserve([{ variantId: v.variantId, qty: 5 }], { ttlSec: 900, reference: 'mix' });
    if (!r.ok) throw new Error('expected a reservation');
    await commit(r.reservation.reservationId);
    await adjust({ variantId: v.variantId, delta: -3, ref: 'damaged' }, newId());
    await adjust({ variantId: v.variantId, delta: 2, reason: 'cancel', ref: 'order-x' }, null);
    await setFromErp([{ variantId: v.variantId, onHand: 99 }]);
    await clearOverride(v.variantId, null);
    await setFromErp([{ variantId: v.variantId, onHand: 17 }], { now: at(3600) });
    await setLevel({ variantId: v.variantId, productId: v.productId, onHand: 11 }, null);
    await seedLevels([{ variantId: v.variantId, productId: v.productId, onHand: 500 }]);
    expect((await getLevel(v.variantId))?.onHand).toBe(11);
    expect(await ledgerMismatches(t)).toEqual([]);
  });

  it('adjust refuses to take stock below zero and an unknown variant', async () => {
    const v = await makeLevel(2);
    await expect(adjust({ variantId: v.variantId, delta: -3 }, null)).rejects.toBeInstanceOf(StockError);
    await expect(adjust({ variantId: newId(), delta: 1 }, null)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('a cancel restock keeps the source; an adjustment makes it manual', async () => {
    const v = await makeLevel(2);
    await adjust({ variantId: v.variantId, delta: 1, reason: 'cancel' }, null);
    expect((await getLevel(v.variantId))?.source).toBe('seed');
    await adjust({ variantId: v.variantId, delta: 1 }, null);
    expect((await getLevel(v.variantId))?.source).toBe('manual');
  });
});

describe('events', () => {
  it('emits stock.changed on sellable changes and stock.low once when crossing the threshold', async () => {
    const v = await makeLevel(8, { lowStockThreshold: 5 });
    await reserve([{ variantId: v.variantId, qty: 2 }], { ttlSec: 900, reference: 'e1' });
    expect(await outboxEvents(t, 'stock.low').then((e) => e.filter((x) => x.payload.variantId === v.variantId))).toHaveLength(0);
    await reserve([{ variantId: v.variantId, qty: 2 }], { ttlSec: 900, reference: 'e2' });
    await reserve([{ variantId: v.variantId, qty: 1 }], { ttlSec: 900, reference: 'e3' });
    const low = (await outboxEvents(t, 'stock.low')).filter((e) => e.payload.variantId === v.variantId);
    expect(low).toEqual([{ event: 'stock.low', payload: { productId: v.productId, variantId: v.variantId, available: 4, threshold: 5 } }]);
    const changed = (await outboxEvents(t, 'stock.changed')).filter((e) => e.payload.variantId === v.variantId).map((e) => e.payload.available);
    expect(changed).toEqual([6, 4, 3]);
  });

  it('uses the settings default threshold for variants without their own', async () => {
    await setSettings(inventorySettings, { defaultLowStockThreshold: 3, notifyMeEnabled: true }, { actorId: null });
    const v = await makeLevel(4);
    expect((await getStock(v.variantId))?.lowStock).toBe(false);
    await reserve([{ variantId: v.variantId, qty: 1 }], { ttlSec: 900, reference: 'd1' });
    expect((await getStock(v.variantId))?.lowStock).toBe(true);
    expect((await outboxEvents(t, 'stock.low')).filter((e) => e.payload.variantId === v.variantId)).toHaveLength(1);
    await setSettings(inventorySettings, { defaultLowStockThreshold: 5, notifyMeEnabled: true }, { actorId: null });
  });

  it('a rolled-back reservation leaves no event behind (outbox)', async () => {
    const v = await makeLevel(3);
    await withTx(async (tx) => {
      await reserve([{ variantId: v.variantId, qty: 1 }], { ttlSec: 900, reference: 'rb', tx });
      throw new Error('abort');
    }).catch(() => undefined);
    expect((await outboxEvents(t, 'stock.changed')).filter((e) => e.payload.variantId === v.variantId)).toHaveLength(0);
  });
});

describe('seed and admin settings', () => {
  it('seedLevels is idempotent: a second run changes nothing', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ variantId: newId(), productId: newId(), sku: `SEED-${i}`, onHand: i * 3, readyInDays: i ? null : 30 }));
    expect(await seedLevels(rows)).toEqual({ inserted: 5, updated: 0, skipped: 0 });
    expect(await seedLevels(rows)).toEqual({ inserted: 0, updated: 0, skipped: 5 });
    expect(await seedLevels(rows.map((r, i) => (i === 0 ? { ...r, onHand: 9 } : r)))).toEqual({ inserted: 0, updated: 1, skipped: 4 });
    expect(await ledgerMismatches(t)).toEqual([]);
  });

  it('threshold and ready-in days change without touching the source', async () => {
    const v = await makeLevel(0);
    await updateLevelSettings({ variantId: v.variantId, readyInDays: 21, lowStockThreshold: 4 }, null);
    expect(await getLevel(v.variantId)).toMatchObject({ availability: 'preorder', readyInDays: 21, lowStockThreshold: 4, source: 'seed' });
  });

  it('admin list filters by source and state and searches by sku', async () => {
    const v = await makeLevel(1, { sku: 'LIST-ZETA-01', lowStockThreshold: 2 });
    await setLevel({ variantId: v.variantId, productId: v.productId, onHand: 1 }, null);
    const base = { q: '', filters: {}, sort: 'sku', dir: 'asc' as const, page: 1 };
    const bySku = await listLevels({ ...base, q: 'zeta' });
    expect(bySku.rows.map((r) => r.variantId)).toEqual([v.variantId]);
    const lowManual = await listLevels({ ...base, filters: { source: 'manual', state: 'low' } });
    expect(lowManual.rows.map((r) => r.variantId)).toContain(v.variantId);
    expect(lowManual.rows.every((r) => r.source === 'manual' && r.lowStock)).toBe(true);
    const byId = await listLevels({ ...base, q: v.productId });
    expect(byId.total).toBe(1);
  });
});
