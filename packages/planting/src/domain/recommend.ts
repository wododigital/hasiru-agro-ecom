// From model membership and district fit to recommended lines, alternates and companions.
import { blockLayout, blocksFor, roleTotals, splitEvenly, type Picks, type PlantPick } from './layout';
import { ROLES, type FitLevel, type Member, type ModelSelection, type ModelWithMembers, type PlanLine, type Role } from './types';

const fitRank: Record<FitLevel, number> = { good: 0, ok: 1, not_recommended: 2 };

/** Members that may be planted in the district: fit `good` or `ok` (unknown climate counts as `ok`). */
export function fitting(members: readonly Member[], fit: Readonly<Record<string, FitLevel | null | undefined>>): Member[] {
  return members.filter((m) => (fit[m.productId] ?? 'ok') !== 'not_recommended');
}

/**
 * Plants chosen per role: fitting members, default picks first, then better fit, then admin position.
 * The rest of the fitting members of a role are its alternates ("View more varieties").
 */
export function choosePicks(
  members: readonly Member[],
  fit: Readonly<Record<string, FitLevel | null | undefined>>,
  perRole: number,
): { picks: Record<Role, Member[]>; alternates: Record<Role, Member[]> } {
  const picks: Record<Role, Member[]> = { M: [], X: [], O: [] };
  const alternates: Record<Role, Member[]> = { M: [], X: [], O: [] };
  const ordered = fitting(members, fit).sort(
    (a, b) =>
      Number(b.isDefaultPick) - Number(a.isDefaultPick) ||
      fitRank[fit[a.productId] ?? 'ok'] - fitRank[fit[b.productId] ?? 'ok'] ||
      a.position - b.position ||
      a.productId.localeCompare(b.productId),
  );
  for (const m of ordered) (picks[m.role].length < perRole ? picks[m.role] : alternates[m.role]).push(m);
  return { picks, alternates };
}

export const toPicks = (picks: Readonly<Record<Role, readonly Member[]>>, label: (productId: string) => string = () => ''): Picks => ({
  M: picks.M.map((m): PlantPick => ({ productId: m.productId, label: label(m.productId) })),
  X: picks.X.map((m): PlantPick => ({ productId: m.productId, label: label(m.productId) })),
  O: picks.O.map((m): PlantPick => ({ productId: m.productId, label: label(m.productId) })),
});

/** One model's recommendation for a piece of land: role totals split evenly over the picks (remainder to the first). */
export function recommendModel(
  model: ModelWithMembers,
  fit: Readonly<Record<string, FitLevel | null | undefined>>,
  land: { sqft: number; boundaryFt: number | null },
  options: { perRole: number; seed?: string | number },
): ModelSelection {
  const { picks } = choosePicks(model.members, fit, options.perRole);
  const block = blockLayout(model, toPicks(picks), { seed: options.seed });
  const totals = roleTotals(model, block.perBlock, land);
  const lines: PlanLine[] = [];
  const emptyRoles: Role[] = [];
  for (const role of ROLES) {
    if (!totals[role]) continue;
    if (!picks[role].length) {
      emptyRoles.push(role);
      continue;
    }
    splitEvenly(totals[role], picks[role].length).forEach((qty, i) => {
      if (qty > 0) lines.push({ productId: picks[role][i]!.productId, role, qty });
    });
  }
  return {
    lines,
    blocks: blocksFor(model, land),
    totalPlants: lines.reduce((s, l) => s + l.qty, 0),
    emptyRoles,
  };
}

/** Unit price at a quantity from one quote: the tier (current or next) applies once qty reaches its minimum. */
export function unitAt(
  quote: { listUnitPaise: number; tier: { minQty: number; unitPaise: number } | null; nextTier: { minQty: number; unitPaise: number } | null },
  qty: number,
): { unitPaise: number; bulk: boolean } {
  // ponytail: one tier step either side of the quoted qty; the cart reprices against the full ladder.
  const tiers = [quote.tier, quote.nextTier].filter((t): t is { minQty: number; unitPaise: number } => t !== null).sort((a, b) => b.minQty - a.minQty);
  const hit = tiers.find((t) => qty >= t.minQty);
  return hit ? { unitPaise: hit.unitPaise, bulk: true } : { unitPaise: quote.listUnitPaise, bulk: false };
}

export interface Membership {
  modelSlug: string;
  productId: string;
  role: Role;
  position: number;
  spacingFt: number | null;
}

const spacingOf = (v: Member['spacingFt']): number | null => (v === null ? null : Array.isArray(v) ? Math.max(v[0], v[1]) : v);

export const membershipsOf = (models: readonly ModelWithMembers[]): Membership[] =>
  models.flatMap((m) => m.members.map((x) => ({ modelSlug: m.slug, productId: x.productId, role: x.role, position: x.position, spacingFt: spacingOf(x.spacingFt) })));

/**
 * "Grows well with": plants that share a model with this one in a different role (they are planted together by
 * design), a bonus for nitrogen fixers and for similar spacing. Deterministic ranking; narration is elsewhere.
 */
export function companionsOf(productId: string, memberships: readonly Membership[], nitrogenFixers: ReadonlySet<string>, limit = 6): string[] {
  const mine = memberships.filter((m) => m.productId === productId);
  if (!mine.length) return [];
  const score = new Map<string, { s: number; pos: number }>();
  for (const own of mine) {
    for (const other of memberships) {
      if (other.modelSlug !== own.modelSlug || other.productId === productId || other.role === own.role) continue;
      const cur = score.get(other.productId) ?? { s: 0, pos: Number.MAX_SAFE_INTEGER };
      cur.s += 2;
      if (own.spacingFt !== null && other.spacingFt !== null && Math.max(own.spacingFt, other.spacingFt) <= 2 * Math.min(own.spacingFt, other.spacingFt)) cur.s += 0.5;
      cur.pos = Math.min(cur.pos, other.position);
      score.set(other.productId, cur);
    }
  }
  if (!nitrogenFixers.has(productId)) for (const [id, v] of score) if (nitrogenFixers.has(id)) v.s += 1;
  return [...score.entries()]
    .sort(([a, x], [b, y]) => y.s - x.s || x.pos - y.pos || a.localeCompare(b))
    .slice(0, limit)
    .map(([id]) => id);
}

/** wa.me link with the message and the plan URL (shared only for unlocked plans). */
export const whatsappShareUrl = (text: string, url: string): string => `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
