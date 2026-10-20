// Inventory in: full pull of every ERP item (keyset pages from the adapter), snapshot, auto-map, then inventory.setFromErp
// for mapped variants (inventory skips manual overrides, A26). Mapped items the ERP no longer reports go to zero.
import { db } from '@ecomkit/core/db';
import { emit } from '@ecomkit/core/events';
import { integrationCall } from '@ecomkit/core/http';
import { setFromErp } from '@ecomkit/inventory/server';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { erpInventoryPageSchema, type ErpInventoryItemParsed } from '../domain';
import { erpItem, erpItemMap, erpSyncRun } from '../schema';
import { autoMap } from './mapping';
import { resolveAdapter } from './ports';
import { loadSettings } from './settings';

const MAX_PAGES = 1000;
const WRITE_CHUNK = 500;

export interface PullSummary {
  status: 'done' | 'failed' | 'disabled' | 'not_due' | 'not_configured';
  runId: string | null;
  items: number;
  changed: number;
  unchanged: number;
  skippedManual: number;
  stale: number;
  zeroed: number;
  autoMapped: number;
  unmapped: number;
  missing: string[];
  error?: string;
}

const empty = (status: PullSummary['status']): PullSummary => ({
  status,
  runId: null,
  items: 0,
  changed: 0,
  unchanged: 0,
  skippedManual: 0,
  stale: 0,
  zeroed: 0,
  autoMapped: 0,
  unmapped: 0,
  missing: [],
});

/** Last finished inventory pull without errors. */
export async function lastGoodPull(): Promise<typeof erpSyncRun.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(erpSyncRun)
    .where(and(eq(erpSyncRun.direction, 'inventory_in'), isNotNull(erpSyncRun.finishedAt), eq(erpSyncRun.errors, 0)))
    .orderBy(desc(erpSyncRun.startedAt))
    .limit(1);
  return row ?? null;
}

async function snapshot(items: readonly ErpInventoryItemParsed[], now: Date): Promise<void> {
  for (let i = 0; i < items.length; i += WRITE_CHUNK) {
    const chunk = items.slice(i, i + WRITE_CHUNK);
    await db
      .insert(erpItem)
      .values(
        chunk.map((it) => ({
          erpItemId: it.erpItemId,
          sku: it.sku,
          name: it.name,
          variety: it.variety,
          available: it.available,
          readyInDays: it.readyInDays,
          costPaise: it.costPaise,
          erpUpdatedAt: new Date(it.updatedAt),
          seenAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: erpItem.erpItemId,
        set: {
          sku: sql`excluded.sku`,
          name: sql`excluded.name`,
          variety: sql`excluded.variety`,
          available: sql`excluded.available`,
          readyInDays: sql`excluded.ready_in_days`,
          costPaise: sql`excluded.cost_paise`,
          erpUpdatedAt: sql`excluded.erp_updated_at`,
          seenAt: sql`excluded.seen_at`,
        },
      });
  }
}

/**
 * One inventory pull. Scheduled every minute and skipped until `pullEveryMinutes` has passed since the last run;
 * `force` (Sync now) ignores the interval. The job is a singleton queue, so two pulls never overlap.
 */
export async function pullInventory(options: { now?: Date; force?: boolean } = {}): Promise<PullSummary> {
  const now = options.now ?? new Date();
  const settings = await loadSettings();
  if (!settings.enabled && !options.force) return empty('disabled');
  if (!options.force) {
    const [last] = await db.select({ startedAt: erpSyncRun.startedAt }).from(erpSyncRun).where(eq(erpSyncRun.direction, 'inventory_in')).orderBy(desc(erpSyncRun.startedAt)).limit(1);
    if (last && now.getTime() - last.startedAt.getTime() < settings.pullEveryMinutes * 60_000 - 5_000) return empty('not_due');
  }
  const adapter = await resolveAdapter();
  if (!adapter) return empty('not_configured');

  const [run] = await db.insert(erpSyncRun).values({ direction: 'inventory_in', transport: adapter.id, startedAt: now }).returning({ id: erpSyncRun.id });
  const summary: PullSummary = { ...empty('done'), runId: run!.id };
  const seen = new Map<string, ErpInventoryItemParsed>();
  let cursor: string | null = null;
  let pages = 0;

  try {
    for (;;) {
      if (++pages > MAX_PAGES) throw new Error(`more than ${MAX_PAGES} pages; stopping`);
      const res = await integrationCall(`erp:${adapter.id}`, 'pull-inventory', () => adapter.pullInventory({ since: null, cursor }));
      if (res.status === 'skipped_not_configured') throw new Error('inventory transport not configured');
      if (res.status === 'failed') throw res.error;
      const page = erpInventoryPageSchema.safeParse(res.value);
      if (!page.success) throw new Error(`invalid inventory page: ${page.error.issues[0]?.path.join('.')} ${page.error.issues[0]?.message}`);
      for (const it of page.data.items) seen.set(it.erpItemId, it);
      await snapshot(page.data.items, now);
      if (!page.data.nextCursor) break;
      if (page.data.nextCursor === cursor) throw new Error('cursor did not advance');
      cursor = page.data.nextCursor;
    }
    summary.items = seen.size;

    summary.autoMapped = (await autoMap([...seen.values()], settings.autoMapMinConfidence)).length;
    const links = await db.select({ variantId: erpItemMap.variantId, erpItemId: erpItemMap.erpItemId }).from(erpItemMap);
    const linked = new Set(links.map((l) => l.erpItemId));
    summary.unmapped = [...seen.keys()].filter((id) => !linked.has(id)).length;

    const updates = links.map((l) => {
      const it = seen.get(l.erpItemId);
      if (it) return { variantId: l.variantId, onHand: it.available, readyInDays: it.readyInDays, updatedAt: new Date(it.updatedAt) };
      summary.zeroed++;
      return { variantId: l.variantId, onHand: 0, readyInDays: null, updatedAt: now };
    });
    for (let i = 0; i < updates.length; i += WRITE_CHUNK) {
      const r = await setFromErp(updates.slice(i, i + WRITE_CHUNK), { now });
      summary.changed += r.changed;
      summary.unchanged += r.unchanged;
      summary.skippedManual += r.skippedManual;
      summary.stale += r.stale;
      summary.missing.push(...r.missing);
    }
  } catch (err) {
    summary.status = 'failed';
    summary.error = (err instanceof Error ? err.message : String(err)).slice(0, 500);
  }

  const { status: _status, runId: _runId, ...log } = summary;
  await db
    .update(erpSyncRun)
    .set({ finishedAt: new Date(), items: summary.items, changed: summary.changed, errors: summary.status === 'failed' ? 1 : 0, log: { ...log, pages } })
    .where(eq(erpSyncRun.id, run!.id));
  if (summary.status === 'done') await emit('erp.synced', { runId: run!.id, kind: 'inventory', changed: summary.changed });
  return summary;
}
