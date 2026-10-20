import { createHash } from 'node:crypto';
import type { JobHandler } from '@ecomkit/core/contracts';
import { withTx } from '@ecomkit/core/db';
import { enqueue } from '@ecomkit/core/jobs';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DESTINATIONS, forDestination, stableItemText, toFeedItem, type Destination, type FeedItem, type FeedSourceRow } from '../domain/item';
import { renderGoogleXml, renderMetaCsv } from '../domain/render';
import { hasErrors, validateFeedItem } from '../domain/validate';
import { feedsFile, feedsItemState, feedsRun, type FeedRunLog } from '../schema';
import type { FeedsSettings } from '../settings';
import { feedOrigin, loadSettings } from './config';
import { loadFeedRows } from './source';

export const REGENERATE_JOB = 'feeds.regenerate';
export const CONTENT_TYPES: Readonly<Record<Destination, string>> = { google: 'application/xml; charset=utf-8', meta: 'text/csv; charset=utf-8' };

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

export interface RegenerateReport extends FeedRunLog {
  destination: Destination;
  kind: 'full' | 'delta';
  items: number;
  errors: number;
}

let rowSource: () => Promise<FeedSourceRow[]> = loadFeedRows;
/** Tests and alternative stores can swap the row loader (the default reads catalog, pricing, inventory and media). */
export function setFeedRowSource(next: (() => Promise<FeedSourceRow[]>) | null): void {
  rowSource = next ?? loadFeedRows;
}

const enabled = (s: FeedsSettings, d: Destination) => (d === 'google' ? s.googleEnabled : s.metaEnabled);

function render(destination: Destination, items: readonly FeedItem[], origin: string, brand: string): string {
  if (destination === 'meta') return renderMetaCsv(items);
  return renderGoogleXml(items, { title: brand || new URL(origin).host, link: origin, description: 'Product feed' });
}

/**
 * Rebuilds the feed files. Every item is validated per destination (errors keep it out and are reported), hashed,
 * and compared with `feeds_item_state`: the file is rewritten only when an item was added, changed or removed
 * (or `force`), so a debounced burst of events with no visible change costs one read and no write.
 */
export async function regenerateFeeds(options: { force?: boolean; destinations?: readonly Destination[]; now?: Date } = {}): Promise<RegenerateReport[]> {
  const s = await loadSettings();
  const now = options.now ?? new Date();
  const origin = feedOrigin();
  const destinations = (options.destinations ?? DESTINATIONS).filter((d) => enabled(s, d));
  if (!destinations.length) return [];
  const rows = await rowSource();
  const ctx = { origin, brand: s.brand, googleCategory: { plant: s.googleCategoryPlant, input: s.googleCategoryInput }, now };
  const base = rows.map((row) => ({ row, item: toFeedItem(row, ctx) }));
  const reports: RegenerateReport[] = [];

  for (const destination of destinations) {
    const started = new Date();
    const issues: FeedRunLog['issues'] = [];
    const included: { item: FeedItem; hash: string }[] = [];
    const rejected = new Map<string, string>();
    for (const { row, item: generic } of base) {
      // One bad product records a validation error and never kills the run.
      try {
        const item = forDestination(generic, row, destination, origin);
        if (item.availability === 'out_of_stock' && !s.includeOutOfStock) continue;
        const found = validateFeedItem(item, destination, { requireHttps: origin.startsWith('https:') });
        for (const i of found) issues.push({ itemId: item.id, variantId: item.variantId, ...i });
        if (hasErrors(found)) rejected.set(item.variantId, found.filter((i) => i.severity === 'error').map((i) => `${i.field}: ${i.message}`).join('; '));
        else included.push({ item, hash: sha256(stableItemText(item)) });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        issues.push({ itemId: generic.id, variantId: generic.variantId, field: 'item', severity: 'error', message });
        rejected.set(generic.variantId, `item: ${message}`);
      }
    }

    const report = await withTx(async (tx) => {
      const [states, [file]] = await Promise.all([
        tx.select().from(feedsItemState).where(eq(feedsItemState.destination, destination)),
        tx.select({ etag: feedsFile.etag }).from(feedsFile).where(eq(feedsFile.destination, destination)).for('update'),
      ]);
      const prev = new Map(states.map((r) => [r.variantId, r]));
      const keep = new Set(included.map((i) => i.item.variantId));
      let added = 0;
      let changed = 0;
      let unchanged = 0;
      for (const { item, hash } of included) {
        const p = prev.get(item.variantId);
        if (!p?.hash) added++;
        else if (p.hash !== hash) changed++;
        else unchanged++;
      }
      const removed = states.filter((r) => r.hash && !keep.has(r.variantId)).length;
      const rewritten = !!options.force || !file || added + changed + removed > 0;
      const kind: 'full' | 'delta' = options.force || !file ? 'full' : 'delta';

      if (rewritten) {
        const items = included.map((i) => i.item).sort((a, b) => a.id.localeCompare(b.id));
        const body = render(destination, items, origin, s.brand);
        const values = { destination, body, contentType: CONTENT_TYPES[destination], etag: `"${sha256(body).slice(0, 32)}"`, items: items.length, generatedAt: now };
        await tx.insert(feedsFile).values(values).onConflictDoUpdate({ target: feedsFile.destination, set: values });
      }
      const touched = included.filter(({ item, hash }) => prev.get(item.variantId)?.hash !== hash || prev.get(item.variantId)?.lastError);
      if (touched.length) {
        await tx
          .insert(feedsItemState)
          .values(touched.map(({ item, hash }) => ({ destination, variantId: item.variantId, hash, lastPushedAt: now, lastError: null })))
          .onConflictDoUpdate({
            target: [feedsItemState.destination, feedsItemState.variantId],
            set: { hash: sql`excluded.hash`, lastPushedAt: sql`excluded.last_pushed_at`, lastError: sql`excluded.last_error` },
          });
      }
      const errored = [...rejected].filter(([variantId, error]) => prev.get(variantId)?.lastError !== error || prev.get(variantId)?.hash);
      if (errored.length) {
        await tx
          .insert(feedsItemState)
          .values(errored.map(([variantId, lastError]) => ({ destination, variantId, hash: null, lastPushedAt: null, lastError })))
          .onConflictDoUpdate({ target: [feedsItemState.destination, feedsItemState.variantId], set: { hash: sql`excluded.hash`, lastError: sql`excluded.last_error` } });
      }
      const gone = states.filter((r) => !keep.has(r.variantId) && !rejected.has(r.variantId)).map((r) => r.variantId);
      if (gone.length) await tx.delete(feedsItemState).where(and(eq(feedsItemState.destination, destination), inArray(feedsItemState.variantId, gone)));

      const log: FeedRunLog = { added, changed, removed, unchanged, rewritten, issues: issues.slice(0, 500) };
      await tx.insert(feedsRun).values({ destination, kind, items: included.length, errors: rejected.size, startedAt: started, finishedAt: new Date(), log });
      return { destination, kind, items: included.length, errors: rejected.size, ...log };
    });
    reports.push(report);
  }
  return reports;
}

export const regenerateJob: JobHandler<{ force?: boolean }> = async (data, ctx) => {
  const reports = await regenerateFeeds({ force: !!data?.force });
  for (const r of reports) ctx.log.info('feeds rebuilt', { destination: r.destination, items: r.items, errors: r.errors, rewritten: r.rewritten, added: r.added, changed: r.changed, removed: r.removed });
};

/**
 * Debounce: the first change schedules one rebuild `debounceSec` later; the queue's `short` policy allows a single
 * queued job, so further changes inside the window fold into it (pg-boss returns null for them).
 */
export async function scheduleRegenerate(now = Date.now()): Promise<string | null> {
  const s = await loadSettings();
  return enqueue(REGENERATE_JOB, {}, { startAfter: new Date(now + s.debounceSec * 1000) });
}

/** Subscriber for product.updated, product.published, price.changed and stock.changed (payloads are not needed). */
export const onChange = async (): Promise<void> => {
  await scheduleRegenerate();
};
