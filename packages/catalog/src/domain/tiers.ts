import type { PriceQuote } from '@ecomkit/core/contracts';

export interface TierStep {
  minQty: number;
  unitPaise: number;
}

/**
 * Walks a variant's tier ladder through the pricing reader's quote (each quote names its next tier).
 * Returns the list price at qty 1 followed by every bulk tier, ascending. `maxSteps` bounds a misconfigured ladder.
 */
export async function tierLadder(getPrice: (qty: number) => Promise<PriceQuote | null>, maxSteps = 8): Promise<{ list: TierStep; tiers: TierStep[] } | null> {
  const first = await getPrice(1);
  if (!first) return null;
  const tiers: TierStep[] = [];
  let next = first.nextTier;
  while (next && tiers.length < maxSteps) {
    tiers.push({ minQty: next.minQty, unitPaise: next.unitPaise });
    const q = await getPrice(next.minQty);
    next = q?.nextTier && q.nextTier.minQty > next.minQty ? q.nextTier : null;
  }
  return { list: { minQty: 1, unitPaise: first.listUnitPaise }, tiers };
}

/** Unit price for qty on a ladder (the highest tier reached), and the next tier with what it saves at its threshold. */
export function tierAt(list: TierStep, tiers: readonly TierStep[], qty: number): { unitPaise: number; next: (TierStep & { more: number; savePaise: number }) | null } {
  let unit = list.unitPaise;
  for (const t of tiers) if (qty >= t.minQty) unit = t.unitPaise;
  const n = tiers.find((t) => t.minQty > qty);
  return { unitPaise: unit, next: n ? { ...n, more: n.minQty - qty, savePaise: (unit - n.unitPaise) * n.minQty } : null };
}
