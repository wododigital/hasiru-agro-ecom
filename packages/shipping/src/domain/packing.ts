import { z } from 'zod';

// Packing fee rules (plan section 3: scope order | product | size_class | qty_band).
// Per line: the first matching line rule (by position) sets the per-unit fee; with no match the line keeps its own
// per-unit fee (catalog_variant.packing_fee_paise, which the cart passes in). Order rules add a flat fee once.

export const PACKING_SCOPES = ['order', 'product', 'size_class', 'qty_band'] as const;
export type PackingScope = (typeof PACKING_SCOPES)[number];

export const packingMatchSchemas = {
  order: z.object({}).strict(),
  product: z
    .object({ productIds: z.array(z.string().min(1)).max(500).default([]), variantIds: z.array(z.string().min(1)).max(500).default([]) })
    .strict()
    .refine((m) => m.productIds.length + m.variantIds.length > 0, { message: 'name at least one product or variant' }),
  size_class: z.object({ sizeClass: z.string().trim().min(1).max(20) }).strict(),
  qty_band: z
    .object({ minQty: z.int().min(1), maxQty: z.int().min(1).nullable().default(null) })
    .strict()
    .refine((m) => m.maxQty === null || m.maxQty >= m.minQty, { message: 'maxQty below minQty' }),
} as const;

export type PackingMatch = {
  order: Record<string, never>;
  product: { productIds: string[]; variantIds: string[] };
  size_class: { sizeClass: string };
  qty_band: { minQty: number; maxQty: number | null };
};

export type PackingRule = { [S in PackingScope]: { id: string; scope: S; match: PackingMatch[S]; feePaise: number; position: number } }[PackingScope];

export interface PackingLine {
  variantId: string;
  qty: number;
  /** Default per-unit fee carried by the line. */
  packingFeePaise: number;
  productId?: string | null;
  sizeClass?: string | null;
}

/** Parses a stored rule's match; null when the stored JSON no longer fits the scope (the rule is then ignored). */
export function parsePackingMatch<S extends PackingScope>(scope: S, match: unknown): PackingMatch[S] | null {
  const r = packingMatchSchemas[scope].safeParse(match ?? {});
  return r.success ? (r.data as PackingMatch[S]) : null;
}

function lineMatches(rule: PackingRule, line: PackingLine): boolean {
  switch (rule.scope) {
    case 'product':
      return rule.match.variantIds.includes(line.variantId) || (!!line.productId && rule.match.productIds.includes(line.productId));
    case 'size_class':
      return !!line.sizeClass && line.sizeClass === rule.match.sizeClass;
    case 'qty_band':
      return line.qty >= rule.match.minQty && (rule.match.maxQty === null || line.qty <= rule.match.maxQty);
    case 'order':
      return false;
  }
}

export interface PackingBreakdown {
  totalPaise: number;
  lines: { variantId: string; unitPaise: number; ruleId: string | null }[];
  orderRuleIds: string[];
}

export function packingFee(lines: readonly PackingLine[], rules: readonly PackingRule[]): PackingBreakdown {
  const sorted = [...rules].sort((a, b) => a.position - b.position);
  const lineRules = sorted.filter((r) => r.scope !== 'order');
  const out: PackingBreakdown = { totalPaise: 0, lines: [], orderRuleIds: [] };
  let units = 0;
  for (const line of lines) {
    if (!(line.qty > 0)) continue;
    units += line.qty;
    const rule = lineRules.find((r) => lineMatches(r, line)) ?? null;
    const unitPaise = rule ? rule.feePaise : Math.max(0, line.packingFeePaise);
    out.totalPaise += unitPaise * line.qty;
    out.lines.push({ variantId: line.variantId, unitPaise, ruleId: rule?.id ?? null });
  }
  if (units > 0) {
    for (const r of sorted) {
      if (r.scope !== 'order') continue;
      out.totalPaise += r.feePaise;
      out.orderRuleIds.push(r.id);
    }
  }
  return out;
}
