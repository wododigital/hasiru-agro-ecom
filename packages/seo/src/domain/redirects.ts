import { normalisePath } from './paths';

export type RedirectPlan =
  | { ok: true; from: string; to: string; /** Every row to upsert (`from -> to`), the new one first, then re-pointed chains. */ upserts: readonly [string, string][] }
  | { ok: false; reason: 'invalid' | 'same' | 'loop' };

/** Hops followed before a chain is treated as a loop. */
export const MAX_CHAIN = 20;

/**
 * Plans adding `from -> to` against the existing map (from -> to) with two guarantees: no loops (the new
 * target, followed through existing redirects, never reaches `from`) and no chains (the new row points at
 * the final target, and rows that pointed at `from` are re-pointed there too), so every redirect is one hop.
 */
export function planRedirect(existing: ReadonlyMap<string, string>, fromInput: string, toInput: string): RedirectPlan {
  const from = normalisePath(fromInput);
  const to = normalisePath(toInput);
  if (!from || !to) return { ok: false, reason: 'invalid' };
  if (from === to) return { ok: false, reason: 'same' };

  let target = to;
  const seen = new Set([from]);
  for (let hops = 0; existing.has(target); hops++) {
    if (seen.has(target) || hops >= MAX_CHAIN) return { ok: false, reason: 'loop' };
    seen.add(target);
    target = existing.get(target)!;
  }
  if (target === from) return { ok: false, reason: 'loop' };

  const upserts: [string, string][] = [[from, target]];
  for (const [source, dest] of existing) if (dest === from && source !== from) upserts.push([source, target]);
  return { ok: true, from, to: target, upserts };
}
