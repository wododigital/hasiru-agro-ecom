// Stock levels, reservations and the movements ledger. Every write locks level rows in variant_id order
// (reservation rows first where both are touched), so concurrent writers serialise without deadlocks.
import { audit } from '@ecomkit/core/audit';
import { invalidateTags, tags } from '@ecomkit/core/cache-tags';
import type { ReserveLine, ReserveResult, StockInfo } from '@ecomkit/core/contracts';
import { db, withTx, type DbOrTx, type Tx } from '@ecomkit/core/db';
import { emit } from '@ecomkit/core/events';
import { newId } from '@ecomkit/core/ids';
import { defineSettings, getSettings } from '@ecomkit/core/settings';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import {
  adjustSchema,
  crossedLowStock,
  deriveStock,
  erpItemSchema,
  inventorySettingsSchema,
  levelSettingsSchema,
  reserveLinesSchema,
  reserveOptionsSchema,
  seedLevelSchema,
  setLevelSchema,
  type AdjustInput,
  type ErpItem,
  type SeedLevel,
  type SetLevelInput,
} from '../domain';
import { inventoryLevel, inventoryMovement, inventoryReservation } from '../schema';

export const inventorySettings = defineSettings('inventory', inventorySettingsSchema);

type Level = typeof inventoryLevel.$inferSelect;
type MovementReason = (typeof inventoryMovement.$inferInsert)['reason'];

export class ReservationError extends Error {
  constructor(
    readonly code: 'not_found' | 'released',
    readonly reservationId: string,
  ) {
    super(`reservation ${reservationId}: ${code}`);
    this.name = 'ReservationError';
  }
}

export class StockError extends Error {
  constructor(
    readonly code: 'not_found' | 'negative',
    readonly variantId: string,
  ) {
    super(`inventory ${variantId}: ${code}`);
    this.name = 'StockError';
  }
}

/** A Drizzle transaction passed through the contract's `tx?: unknown`, or a fresh one. */
async function inTx<T>(tx: unknown, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (tx === undefined || tx === null) return withTx(fn);
  if (typeof (tx as { execute?: unknown }).execute !== 'function') throw new TypeError('inventory: tx must be a Drizzle transaction');
  return fn(tx as Tx);
}

export async function fallbackThreshold(dbOrTx: DbOrTx = db): Promise<number | null> {
  return (await getSettings(inventorySettings, dbOrTx)).defaultLowStockThreshold;
}

const available = (l: Pick<Level, 'onHand' | 'reserved'>) => Math.max(0, l.onHand - l.reserved);

async function lockLevels(tx: Tx, variantIds: readonly string[]): Promise<Map<string, Level>> {
  if (!variantIds.length) return new Map();
  const rows = await tx
    .select()
    .from(inventoryLevel)
    .where(inArray(inventoryLevel.variantId, [...variantIds]))
    .orderBy(asc(inventoryLevel.variantId))
    .for('update');
  return new Map(rows.map((r) => [r.variantId, r]));
}

interface Change {
  productId: string;
  variantId: string;
  before: number;
  after: number;
  threshold: number | null;
}

/** Outbox events for every sellable-stock change, written in the same transaction. */
async function emitChanges(tx: Tx, changes: readonly Change[]): Promise<void> {
  const fallback = changes.some((c) => c.threshold === null) ? await fallbackThreshold(tx) : null;
  for (const c of changes) {
    if (c.before === c.after) continue;
    await emit('stock.changed', { productId: c.productId, variantId: c.variantId, available: c.after }, { tx });
    const threshold = c.threshold ?? fallback;
    if (crossedLowStock(c.before, c.after, threshold)) {
      await emit('stock.low', { productId: c.productId, variantId: c.variantId, available: c.after, threshold: threshold! }, { tx });
    }
  }
}

/** Expire storefront caches straight away when this module owned the transaction (the stock.changed subscriber does it for callers' transactions). */
async function expire(changes: readonly Change[], ownTx: boolean): Promise<void> {
  if (!ownTx) return;
  const list = changes.filter((c) => c.before !== c.after).flatMap((c) => [tags.stock(c.productId), tags.stock(c.variantId)]);
  await invalidateTags([...new Set(list)]);
}

async function movement(tx: Tx, variantId: string, delta: number, reason: MovementReason, ref: string | null, actorId: string | null): Promise<void> {
  if (delta !== 0) await tx.insert(inventoryMovement).values({ variantId, delta, reason, ref, actorId });
}

// ---- reads -----------------------------------------------------------------

export async function getStocks(variantIds: readonly string[]): Promise<Record<string, StockInfo>> {
  if (!variantIds.length) return {};
  const [rows, fallback] = await Promise.all([
    db.select().from(inventoryLevel).where(inArray(inventoryLevel.variantId, [...new Set(variantIds)])),
    fallbackThreshold(),
  ]);
  return Object.fromEntries(rows.map((r) => [r.variantId, deriveStock(r, fallback)]));
}

export async function getStock(variantId: string): Promise<StockInfo | null> {
  return (await getStocks([variantId]))[variantId] ?? null;
}

export interface LevelView extends StockInfo {
  productId: string;
  sku: string | null;
  source: Level['source'];
  lowStockThreshold: number | null;
  erpOnHand: number | null;
  erpUpdatedAt: Date | null;
  updatedAt: Date;
}

export const toView = (r: Level, fallback: number | null): LevelView => ({
  ...deriveStock(r, fallback),
  productId: r.productId,
  sku: r.sku,
  source: r.source,
  lowStockThreshold: r.lowStockThreshold,
  erpOnHand: r.erpOnHand,
  erpUpdatedAt: r.erpUpdatedAt,
  updatedAt: r.updatedAt,
});

export async function getLevel(variantId: string): Promise<LevelView | null> {
  const [row] = await db.select().from(inventoryLevel).where(eq(inventoryLevel.variantId, variantId));
  return row ? toView(row, await fallbackThreshold()) : null;
}

/** Every variant level of one product (product form tab, PDP notify-me section). */
export async function levelsForProduct(productId: string): Promise<LevelView[]> {
  const [rows, fallback] = await Promise.all([
    db.select().from(inventoryLevel).where(eq(inventoryLevel.productId, productId)).orderBy(asc(inventoryLevel.sku), asc(inventoryLevel.variantId)),
    fallbackThreshold(),
  ]);
  return rows.map((r) => toView(r, fallback));
}

export async function listMovements(variantId: string, limit = 50) {
  return db
    .select()
    .from(inventoryMovement)
    .where(eq(inventoryMovement.variantId, variantId))
    .orderBy(sql`${inventoryMovement.id} desc`)
    .limit(Math.min(Math.max(limit, 1), 500));
}

// ---- reservations (inventory-ops contract) ---------------------------------

export interface ReserveOptions {
  ttlSec: number;
  reference: string;
  tx?: unknown;
  /** Clock for tests; production uses the app clock. */
  now?: Date;
}

/**
 * Holds stock for a payment attempt. All lines or none: a shortage on any line returns the shortages
 * and writes nothing. Concurrent calls on the same variants queue on the row locks, so stock never oversells.
 */
export async function reserve(lines: readonly ReserveLine[], options: ReserveOptions): Promise<ReserveResult> {
  const parsedLines = reserveLinesSchema.parse(lines);
  const { ttlSec, reference } = reserveOptionsSchema.parse(options);
  const merged = new Map<string, number>();
  for (const l of parsedLines) merged.set(l.variantId, (merged.get(l.variantId) ?? 0) + l.qty);
  const ids = [...merged.keys()].sort();
  const now = options.now ?? new Date();
  const expiresAt = new Date(now.getTime() + ttlSec * 1000);

  const run = async (tx: Tx) => {
    const levels = await lockLevels(tx, ids);
    const shortages = ids
      .map((variantId) => ({ variantId, requested: merged.get(variantId)!, available: levels.has(variantId) ? available(levels.get(variantId)!) : 0 }))
      .filter((s) => s.available < s.requested);
    if (shortages.length) return { result: { ok: false as const, shortages }, changes: [] };

    const reservationId = newId();
    const changes: Change[] = [];
    for (const variantId of ids) {
      const level = levels.get(variantId)!;
      const qty = merged.get(variantId)!;
      await tx
        .update(inventoryLevel)
        .set({ reserved: sql`${inventoryLevel.reserved} + ${qty}`, updatedAt: now })
        .where(eq(inventoryLevel.variantId, variantId));
      changes.push({ productId: level.productId, variantId, before: available(level), after: available(level) - qty, threshold: level.lowStockThreshold });
    }
    await tx.insert(inventoryReservation).values(ids.map((variantId) => ({ id: reservationId, variantId, qty: merged.get(variantId)!, reference, expiresAt, createdAt: now, updatedAt: now })));
    await emitChanges(tx, changes);
    return {
      result: { ok: true as const, reservation: { reservationId, expiresAt, lines: ids.map((variantId) => ({ variantId, qty: merged.get(variantId)! })) } },
      changes,
    };
  };

  const { result, changes } = await inTx(options.tx, run);
  await expire(changes, options.tx == null);
  return result;
}

async function lockReservation(tx: Tx, reservationId: string) {
  return tx.select().from(inventoryReservation).where(eq(inventoryReservation.id, reservationId)).orderBy(asc(inventoryReservation.variantId)).for('update');
}

/**
 * Payment succeeded: the held quantity leaves stock (ledger reason `order`). Idempotent for a committed
 * reservation; a released one throws `ReservationError('released')` so the caller can raise the late-payment alert (A27).
 */
export async function commit(reservationId: string, options: { tx?: unknown; now?: Date } = {}): Promise<void> {
  const now = options.now ?? new Date();
  const changes = await inTx(options.tx, async (tx) => {
    const rows = await lockReservation(tx, reservationId);
    if (!rows.length) throw new ReservationError('not_found', reservationId);
    if (rows.some((r) => r.status === 'released')) throw new ReservationError('released', reservationId);
    const held = rows.filter((r) => r.status === 'held');
    if (!held.length) return [];
    const levels = await lockLevels(tx, held.map((r) => r.variantId));
    const out: Change[] = [];
    for (const r of held) {
      const level = levels.get(r.variantId);
      if (!level) continue;
      const onHand = Math.max(0, level.onHand - r.qty);
      const reserved = Math.max(0, level.reserved - r.qty);
      await tx.update(inventoryLevel).set({ onHand, reserved, updatedAt: now }).where(eq(inventoryLevel.variantId, r.variantId));
      await movement(tx, r.variantId, onHand - level.onHand, 'order', r.reference, null);
      out.push({ productId: level.productId, variantId: r.variantId, before: available(level), after: Math.max(0, onHand - reserved), threshold: level.lowStockThreshold });
    }
    await tx
      .update(inventoryReservation)
      .set({ status: 'committed', updatedAt: now })
      .where(and(eq(inventoryReservation.id, reservationId), eq(inventoryReservation.status, 'held')));
    await emitChanges(tx, out);
    return out;
  });
  await expire(changes, options.tx == null);
}

async function releaseRows(tx: Tx, rows: readonly (typeof inventoryReservation.$inferSelect)[], now: Date): Promise<Change[]> {
  const qtyByVariant = new Map<string, number>();
  for (const r of rows) qtyByVariant.set(r.variantId, (qtyByVariant.get(r.variantId) ?? 0) + r.qty);
  const levels = await lockLevels(tx, [...qtyByVariant.keys()].sort());
  const out: Change[] = [];
  for (const [variantId, qty] of qtyByVariant) {
    const level = levels.get(variantId);
    if (!level) continue;
    const reserved = Math.max(0, level.reserved - qty);
    await tx.update(inventoryLevel).set({ reserved, updatedAt: now }).where(eq(inventoryLevel.variantId, variantId));
    out.push({ productId: level.productId, variantId, before: available(level), after: Math.max(0, level.onHand - reserved), threshold: level.lowStockThreshold });
  }
  for (const id of new Set(rows.map((r) => r.id))) {
    await tx
      .update(inventoryReservation)
      .set({ status: 'released', updatedAt: now })
      .where(and(eq(inventoryReservation.id, id), eq(inventoryReservation.status, 'held'), inArray(inventoryReservation.variantId, rows.filter((r) => r.id === id).map((r) => r.variantId))));
  }
  await emitChanges(tx, out);
  return out;
}

/** Payment failed or abandoned: the hold goes back to sellable stock. A no-op unless the reservation is held. */
export async function release(reservationId: string, options: { tx?: unknown; now?: Date } = {}): Promise<void> {
  const now = options.now ?? new Date();
  const changes = await inTx(options.tx, async (tx) => {
    const held = (await lockReservation(tx, reservationId)).filter((r) => r.status === 'held');
    return held.length ? releaseRows(tx, held, now) : [];
  });
  await expire(changes, options.tx == null);
}

/** TTL sweep (job `inventory.release-expired`, every minute): releases holds past `expires_at`. Returns rows released. */
export async function releaseExpired(options: { now?: Date; limit?: number } = {}): Promise<number> {
  const now = options.now ?? new Date();
  const { count, changes } = await withTx(async (tx) => {
    const rows = await tx
      .select()
      .from(inventoryReservation)
      .where(and(eq(inventoryReservation.status, 'held'), lte(inventoryReservation.expiresAt, now)))
      .orderBy(asc(inventoryReservation.variantId), asc(inventoryReservation.id))
      .limit(options.limit ?? 500)
      .for('update', { skipLocked: true });
    return { count: rows.length, changes: rows.length ? await releaseRows(tx, rows, now) : [] };
  });
  await expire(changes, true);
  return count;
}

// ---- admin and ERP writes --------------------------------------------------

/** Admin count: sets on_hand and marks the row `manual`, which ERP pulls then leave alone until clearOverride (A26). */
export async function setLevel(input: SetLevelInput, actorId: string | null, options: { now?: Date } = {}): Promise<LevelView> {
  const v = setLevelSchema.parse(input);
  const now = options.now ?? new Date();
  const { row, changes } = await withTx(async (tx) => {
    await tx.insert(inventoryLevel).values({ variantId: v.variantId, productId: v.productId, sku: v.sku ?? null, onHand: 0, source: 'manual' }).onConflictDoNothing();
    const before = (await lockLevels(tx, [v.variantId])).get(v.variantId)!;
    const [row] = await tx
      .update(inventoryLevel)
      .set({
        onHand: v.onHand,
        source: 'manual',
        updatedAt: now,
        ...(v.sku !== undefined ? { sku: v.sku } : {}),
        ...(v.readyInDays !== undefined ? { readyInDays: v.readyInDays } : {}),
        ...(v.lowStockThreshold !== undefined ? { lowStockThreshold: v.lowStockThreshold } : {}),
      })
      .where(eq(inventoryLevel.variantId, v.variantId))
      .returning();
    await movement(tx, v.variantId, v.onHand - before.onHand, 'adjust', v.note ?? null, actorId);
    await audit(
      { actorId, actorType: actorId ? 'staff' : 'system', action: 'inventory.set', entity: 'inventory_level', entityId: v.variantId, before: { onHand: before.onHand, source: before.source }, after: { onHand: v.onHand, source: 'manual' } },
      { tx },
    );
    const changes = [{ productId: row!.productId, variantId: v.variantId, before: available(before), after: available(row!), threshold: row!.lowStockThreshold }];
    await emitChanges(tx, changes);
    return { row: row!, changes };
  });
  await expire(changes, true);
  return toView(row, await fallbackThreshold());
}

/** Relative change. `adjust` (write-off, recount difference) is a manual override; `cancel` (restock of a cancelled order) keeps the source. */
export async function adjust(input: AdjustInput, actorId: string | null, options: { tx?: unknown; now?: Date } = {}): Promise<void> {
  const v = adjustSchema.parse(input);
  const now = options.now ?? new Date();
  const changes = await inTx(options.tx, async (tx) => {
    const level = (await lockLevels(tx, [v.variantId])).get(v.variantId);
    if (!level) throw new StockError('not_found', v.variantId);
    const onHand = level.onHand + v.delta;
    if (onHand < 0) throw new StockError('negative', v.variantId);
    const [row] = await tx
      .update(inventoryLevel)
      .set({ onHand, updatedAt: now, ...(v.reason === 'adjust' ? { source: 'manual' as const } : {}) })
      .where(eq(inventoryLevel.variantId, v.variantId))
      .returning();
    await movement(tx, v.variantId, v.delta, v.reason, v.ref ?? null, actorId);
    if (v.reason === 'adjust') {
      await audit({ actorId, actorType: actorId ? 'staff' : 'system', action: 'inventory.adjust', entity: 'inventory_level', entityId: v.variantId, before: { onHand: level.onHand }, after: { onHand } }, { tx });
    }
    const out = [{ productId: level.productId, variantId: v.variantId, before: available(level), after: available(row!), threshold: level.lowStockThreshold }];
    await emitChanges(tx, out);
    return out;
  });
  await expire(changes, options.tx == null);
}

/** Threshold and ready-in days; not a count, so the source stays as it is. */
export async function updateLevelSettings(input: { variantId: string; readyInDays: number | null; lowStockThreshold: number | null }, actorId: string | null): Promise<void> {
  const v = levelSettingsSchema.parse(input);
  const changes = await withTx(async (tx) => {
    const level = (await lockLevels(tx, [v.variantId])).get(v.variantId);
    if (!level) throw new StockError('not_found', v.variantId);
    const [row] = await tx
      .update(inventoryLevel)
      .set({ readyInDays: v.readyInDays, lowStockThreshold: v.lowStockThreshold, updatedAt: new Date() })
      .where(eq(inventoryLevel.variantId, v.variantId))
      .returning();
    await audit(
      { actorId, actorType: actorId ? 'staff' : 'system', action: 'inventory.settings', entity: 'inventory_level', entityId: v.variantId, before: { readyInDays: level.readyInDays, lowStockThreshold: level.lowStockThreshold }, after: { readyInDays: row!.readyInDays, lowStockThreshold: row!.lowStockThreshold } },
      { tx },
    );
    // Availability can flip between preorder and out of stock; storefront caches need the new state.
    return [{ productId: level.productId, variantId: v.variantId, before: -1, after: available(row!), threshold: row!.lowStockThreshold }];
  });
  await expire(changes, true);
}

/** Ends a manual override: the row follows the ERP again, starting from the last number the ERP reported. */
export async function clearOverride(variantId: string, actorId: string | null, options: { now?: Date } = {}): Promise<void> {
  const now = options.now ?? new Date();
  const changes = await withTx(async (tx) => {
    const level = (await lockLevels(tx, [variantId])).get(variantId);
    if (!level) throw new StockError('not_found', variantId);
    if (level.source !== 'manual') return [];
    const onHand = level.erpOnHand ?? level.onHand;
    const [row] = await tx.update(inventoryLevel).set({ source: 'erp', onHand, updatedAt: now }).where(eq(inventoryLevel.variantId, variantId)).returning();
    await movement(tx, variantId, onHand - level.onHand, 'erp_sync', 'clear-override', actorId);
    await audit({ actorId, actorType: actorId ? 'staff' : 'system', action: 'inventory.clear_override', entity: 'inventory_level', entityId: variantId, before: { onHand: level.onHand, source: 'manual' }, after: { onHand, source: 'erp' } }, { tx });
    const out = [{ productId: level.productId, variantId, before: available(level), after: available(row!), threshold: level.lowStockThreshold }];
    await emitChanges(tx, out);
    return out;
  });
  await expire(changes, true);
}

export interface ErpPullResult {
  changed: number;
  unchanged: number;
  /** Manual rows: on_hand untouched, the ERP number recorded in erp_on_hand for the drift report. */
  skippedManual: number;
  /** Older than what we already have. */
  stale: number;
  /** No inventory level for these variant ids (the catalog has to create the variant first). */
  missing: string[];
}

/**
 * ERP pull (A26): writes only rows whose source is `erp` or `seed`; `manual` rows keep their number
 * until clearOverride. Call once per page of the pull (one transaction per page).
 */
export async function setFromErp(items: readonly ErpItem[], options: { now?: Date; tx?: unknown } = {}): Promise<ErpPullResult> {
  const parsed = items.map((i) => erpItemSchema.parse(i));
  const byVariant = new Map(parsed.map((i) => [i.variantId, i]));
  const now = options.now ?? new Date();
  const result: ErpPullResult = { changed: 0, unchanged: 0, skippedManual: 0, stale: 0, missing: [] };

  const changes = await inTx(options.tx, async (tx) => {
    const levels = await lockLevels(tx, [...byVariant.keys()].sort());
    const out: Change[] = [];
    for (const [variantId, item] of [...byVariant].sort(([a], [b]) => a.localeCompare(b))) {
      const level = levels.get(variantId);
      if (!level) {
        result.missing.push(variantId);
        continue;
      }
      const reportedAt = item.updatedAt ?? now;
      if (level.erpUpdatedAt && reportedAt < level.erpUpdatedAt) {
        result.stale++;
        continue;
      }
      if (level.source === 'manual') {
        await tx.update(inventoryLevel).set({ erpOnHand: item.onHand, erpUpdatedAt: reportedAt }).where(eq(inventoryLevel.variantId, variantId));
        result.skippedManual++;
        continue;
      }
      const readyInDays = item.readyInDays === undefined ? level.readyInDays : item.readyInDays;
      if (level.onHand === item.onHand && level.readyInDays === readyInDays && level.source === 'erp') {
        await tx.update(inventoryLevel).set({ erpOnHand: item.onHand, erpUpdatedAt: reportedAt }).where(eq(inventoryLevel.variantId, variantId));
        result.unchanged++;
        continue;
      }
      const [row] = await tx
        .update(inventoryLevel)
        .set({ onHand: item.onHand, readyInDays, source: 'erp', erpOnHand: item.onHand, erpUpdatedAt: reportedAt, updatedAt: now })
        .where(eq(inventoryLevel.variantId, variantId))
        .returning();
      await movement(tx, variantId, item.onHand - level.onHand, 'erp_sync', null, null);
      out.push({ productId: level.productId, variantId, before: available(level), after: available(row!), threshold: level.lowStockThreshold });
      result.changed++;
    }
    await emitChanges(tx, out);
    return out;
  });
  await expire(changes, options.tx == null);
  return result;
}

/**
 * Seed load: inserts a level per variant (source `seed`) and refreshes rows still at `seed`.
 * Rows the ERP or an admin has taken over are never touched. A second run with the same input changes nothing.
 */
export async function seedLevels(input: readonly SeedLevel[]): Promise<{ inserted: number; updated: number; skipped: number }> {
  const rows = input.map((r) => seedLevelSchema.parse(r));
  const out = { inserted: 0, updated: 0, skipped: 0 };
  await withTx(async (tx) => {
    const levels = await lockLevels(tx, rows.map((r) => r.variantId).sort());
    for (const r of rows) {
      const want = { productId: r.productId, sku: r.sku ?? null, onHand: r.onHand, readyInDays: r.readyInDays ?? null, lowStockThreshold: r.lowStockThreshold ?? null };
      const level = levels.get(r.variantId);
      if (!level) {
        await tx.insert(inventoryLevel).values({ variantId: r.variantId, ...want, source: 'seed' });
        await movement(tx, r.variantId, r.onHand, 'seed', null, null);
        out.inserted++;
        continue;
      }
      const same = level.productId === want.productId && level.sku === want.sku && level.onHand === want.onHand && level.readyInDays === want.readyInDays && level.lowStockThreshold === want.lowStockThreshold;
      if (level.source !== 'seed' || same) {
        out.skipped++;
        continue;
      }
      await tx.update(inventoryLevel).set({ ...want, updatedAt: new Date() }).where(eq(inventoryLevel.variantId, r.variantId));
      await movement(tx, r.variantId, r.onHand - level.onHand, 'seed', null, null);
      out.updated++;
    }
  });
  return out;
}
