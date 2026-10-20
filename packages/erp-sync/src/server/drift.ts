// Drift report: our stock vs what the ERP last reported, manual overrides highlighted (A26).
import { db } from '@ecomkit/core/db';
import { listLevels, type LevelView } from '@ecomkit/inventory/server';
import { eq } from 'drizzle-orm';
import { erpItem, erpItemMap } from '../schema';

export interface DriftRow {
  variantId: string;
  sku: string | null;
  erpItemId: string;
  erpName: string | null;
  ourOnHand: number | null;
  erpAvailable: number;
  diff: number | null;
  manualOverride: boolean;
}

async function allLevels(): Promise<Map<string, LevelView>> {
  const out = new Map<string, LevelView>();
  for (let page = 1; ; page++) {
    const { rows, total } = await listLevels({ q: '', filters: {}, sort: 'sku', dir: 'asc', page }, 1000);
    for (const r of rows) out.set(r.variantId, r);
    if (page * 1000 >= total || rows.length === 0) return out;
  }
}

/** Mapped variants where our on-hand differs from the ERP number, or a manual override holds. Largest gap first. */
export async function driftReport(): Promise<DriftRow[]> {
  const [links, levels] = await Promise.all([
    db
      .select({ variantId: erpItemMap.variantId, erpItemId: erpItemMap.erpItemId, erpName: erpItemMap.erpName, available: erpItem.available })
      .from(erpItemMap)
      .innerJoin(erpItem, eq(erpItem.erpItemId, erpItemMap.erpItemId)),
    allLevels(),
  ]);
  const rows: DriftRow[] = [];
  for (const l of links) {
    const level = levels.get(l.variantId);
    const ours = level?.onHand ?? null;
    const manual = level?.source === 'manual';
    if (!manual && ours === l.available) continue;
    rows.push({
      variantId: l.variantId,
      sku: level?.sku ?? null,
      erpItemId: l.erpItemId,
      erpName: l.erpName,
      ourOnHand: ours,
      erpAvailable: l.available,
      diff: ours === null ? null : ours - l.available,
      manualOverride: manual,
    });
  }
  return rows.sort((a, b) => Math.abs(b.diff ?? Infinity) - Math.abs(a.diff ?? Infinity) || a.erpItemId.localeCompare(b.erpItemId));
}

export async function driftCsvRows(): Promise<{ filename: string; rows: string[][] }> {
  const rows = await driftReport();
  return {
    filename: 'erp-stock-drift.csv',
    rows: [
      ['variant_id', 'sku', 'erp_item_id', 'erp_name', 'our_on_hand', 'erp_available', 'difference', 'manual_override'],
      ...rows.map((r) => [r.variantId, r.sku ?? '', r.erpItemId, r.erpName ?? '', String(r.ourOnHand ?? ''), String(r.erpAvailable), String(r.diff ?? ''), r.manualOverride ? 'yes' : 'no']),
    ],
  };
}
