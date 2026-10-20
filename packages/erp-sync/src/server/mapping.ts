// Variant <-> ERP item mapping: automatic by SKU or (name, variety) similarity above the threshold, the rest resolved by an admin.
import { audit } from '@ecomkit/core/audit';
import { db, withTx } from '@ecomkit/core/db';
import { listLevels } from '@ecomkit/inventory/server';
import { asc, eq, inArray, notInArray, or } from 'drizzle-orm';
import { proposeMatches, type MatchCandidate, type MatchItem, type MatchProposal } from '../domain';
import { erpItem, erpItemMap } from '../schema';
import { getPorts } from './ports';

export class MappingError extends Error {
  constructor(readonly code: 'unknown_item' | 'unknown_variant') {
    super(code);
    this.name = 'MappingError';
  }
}

/** Every inventory level, page by page (the fallback candidate list: SKU only, no names). */
async function inventoryCandidates(): Promise<MatchCandidate[]> {
  const out: MatchCandidate[] = [];
  for (let page = 1; ; page++) {
    const { rows, total } = await listLevels({ q: '', filters: {}, sort: 'sku', dir: 'asc', page }, 1000);
    for (const r of rows) out.push({ variantId: r.variantId, sku: r.sku, name: r.sku ?? '', variety: null });
    if (page * 1000 >= total || rows.length === 0) return out;
  }
}

/** Catalogue variants with names when the host wired catalog in; otherwise inventory SKUs. */
export async function variantCandidates(): Promise<MatchCandidate[]> {
  const port = getPorts().variantCandidates;
  return port ? port() : inventoryCandidates();
}

/** Links unmapped ERP items whose best match scores at or above `minConfidence`. Returns the new links. */
export async function autoMap(items: readonly MatchItem[], minConfidence: number): Promise<MatchProposal[]> {
  const mapped = await db.select({ variantId: erpItemMap.variantId, erpItemId: erpItemMap.erpItemId }).from(erpItemMap);
  const mappedItems = new Set(mapped.map((m) => m.erpItemId));
  const mappedVariants = new Set(mapped.map((m) => m.variantId));
  const open = items.filter((i) => !mappedItems.has(i.erpItemId));
  if (!open.length) return [];
  const candidates = (await variantCandidates()).filter((c) => !mappedVariants.has(c.variantId));
  const names = new Map(open.map((i) => [i.erpItemId, i.name]));
  const accepted = proposeMatches(open, candidates).filter((p) => p.confidence >= minConfidence);
  if (!accepted.length) return [];
  const inserted = await db
    .insert(erpItemMap)
    .values(accepted.map((p) => ({ variantId: p.variantId, erpItemId: p.erpItemId, erpName: names.get(p.erpItemId) ?? null, mappedBy: 'auto' as const, confidence: p.confidence })))
    .onConflictDoNothing()
    .returning({ variantId: erpItemMap.variantId });
  const ok = new Set(inserted.map((r) => r.variantId));
  return accepted.filter((p) => ok.has(p.variantId));
}

/** Admin link: replaces any link either side already has. The ERP item must have been seen by a pull. */
export async function mapSku(input: { variantId: string; erpItemId: string }, actorId: string): Promise<void> {
  await withTx(async (tx) => {
    const [item] = await tx.select().from(erpItem).where(eq(erpItem.erpItemId, input.erpItemId));
    if (!item) throw new MappingError('unknown_item');
    const before = await tx
      .select()
      .from(erpItemMap)
      .where(or(eq(erpItemMap.variantId, input.variantId), eq(erpItemMap.erpItemId, input.erpItemId)))
      .for('update');
    if (before.length) await tx.delete(erpItemMap).where(or(eq(erpItemMap.variantId, input.variantId), eq(erpItemMap.erpItemId, input.erpItemId)));
    await tx.insert(erpItemMap).values({ variantId: input.variantId, erpItemId: input.erpItemId, erpName: item.name, mappedBy: 'manual', confidence: 1 });
    await audit({ actorId, actorType: 'staff', action: 'erp.map', entity: 'variant', entityId: input.variantId, before: before.length ? { links: before } : null, after: { erpItemId: input.erpItemId } }, { tx });
  });
}

export async function unmapSku(variantId: string, actorId: string): Promise<boolean> {
  return withTx(async (tx) => {
    const [before] = await tx.delete(erpItemMap).where(eq(erpItemMap.variantId, variantId)).returning();
    if (before) await audit({ actorId, actorType: 'staff', action: 'erp.unmap', entity: 'variant', entityId: variantId, before, after: null }, { tx });
    return Boolean(before);
  });
}

export interface MappingOverview {
  mapped: (typeof erpItemMap.$inferSelect & { sku: string | null; available: number | null })[];
  /** ERP items without a variant, with the best suggestion below the auto threshold. */
  unmapped: (typeof erpItem.$inferSelect & { suggestion: (MatchProposal & { label: string }) | null })[];
}

export async function mappingOverview(): Promise<MappingOverview> {
  const mappedRows = await db
    .select({ map: erpItemMap, sku: erpItem.sku, available: erpItem.available })
    .from(erpItemMap)
    .leftJoin(erpItem, eq(erpItem.erpItemId, erpItemMap.erpItemId))
    .orderBy(asc(erpItemMap.erpName), asc(erpItemMap.variantId));
  const mappedIds = mappedRows.map((r) => r.map.erpItemId);
  const unmapped = await db
    .select()
    .from(erpItem)
    .where(mappedIds.length ? notInArray(erpItem.erpItemId, mappedIds) : undefined)
    .orderBy(asc(erpItem.name), asc(erpItem.erpItemId));
  const mappedVariants = new Set(mappedRows.map((r) => r.map.variantId));
  const candidates = unmapped.length ? (await variantCandidates()).filter((c) => !mappedVariants.has(c.variantId)) : [];
  const labels = new Map(candidates.map((c) => [c.variantId, [c.name, c.variety, c.sku && c.sku !== c.name ? `(${c.sku})` : null].filter(Boolean).join(' ')]));
  const best = new Map(proposeMatches(unmapped, candidates).map((p) => [p.erpItemId, { ...p, label: labels.get(p.variantId) ?? p.variantId }]));
  return {
    mapped: mappedRows.map((r) => ({ ...r.map, sku: r.sku, available: r.available })),
    unmapped: unmapped.map((u) => ({ ...u, suggestion: best.get(u.erpItemId) ?? null })),
  };
}

/** ERP item id per linked variant, for the order payload's `lines[].erpItemId` (orders calls this through the host). */
export async function erpItemIdsFor(variantIds: readonly string[]): Promise<Record<string, string>> {
  if (!variantIds.length) return {};
  const rows = await db.select({ variantId: erpItemMap.variantId, erpItemId: erpItemMap.erpItemId }).from(erpItemMap).where(inArray(erpItemMap.variantId, [...variantIds]));
  return Object.fromEntries(rows.map((r) => [r.variantId, r.erpItemId]));
}
