// Pure discount rules: eligibility, allocation to lines, promo selection, admin input, IST windows.
// The A8 coupon-versus-promo stacking decision itself lives once in core.computeTotals.
import { z } from 'zod';
import type { AppliedDiscountInput, Paise } from '@ecomkit/core/contracts';
import { asPaise, paise } from '@ecomkit/core/money';

export type DiscountKind = 'automatic' | 'code';
export type DiscountStatus = 'draft' | 'active' | 'paused' | 'archived';
export type AppliesTo = 'order' | 'collection' | 'products' | 'tags';
export type Eligibility = 'all' | 'segment' | 'first_order';

export interface DiscountRule {
  id: string;
  name: string;
  kind: DiscountKind;
  status: DiscountStatus;
  startsAt: Date | null;
  endsAt: Date | null;
  valueType: 'percent' | 'fixed';
  /** Whole percent (1..100) or fixed paise. */
  value: number;
  appliesTo: AppliesTo;
  targetIds: readonly string[];
  minQty: number | null;
  minSubtotalPaise: number | null;
  customerEligibility: Eligibility;
  segmentId: string | null;
  usageLimitTotal: number | null;
  usageLimitPerCustomer: number | null;
  stackable: boolean;
  priority: number;
  descriptionPublic: string | null;
}

/** A cart line as discounts sees it: priced at the bulk-tier unit price (A8: tiers come first). */
export interface DiscountCartLine {
  lineId: string;
  productId: string;
  qty: number;
  unitPaise: number;
  collectionIds?: readonly string[];
  tagIds?: readonly string[];
}

/** Supplied by the caller (cart/checkout know the customer; customers computes segments). */
export interface DiscountCustomer {
  isFirstOrder: boolean;
  segmentIds: readonly string[];
}

export interface DiscountCart {
  lines: readonly DiscountCartLine[];
  customer: DiscountCustomer | null;
}

export type IneligibleReason = 'inactive' | 'not_started' | 'ended' | 'not_eligible' | 'no_matching_items' | 'min_qty' | 'min_subtotal';

export type Evaluation =
  | { ok: true; discount: AppliedDiscountInput; amountPaise: Paise }
  | { ok: false; reason: IneligibleReason; /** min_qty / min_subtotal: what is still missing. */ shortBy?: number };

/** Live = active and inside the window (starts inclusive, ends exclusive). Instants, so IST is handled at input. */
export function windowState(rule: Pick<DiscountRule, 'status' | 'startsAt' | 'endsAt'>, now: Date): 'live' | 'inactive' | 'not_started' | 'ended' {
  if (rule.status !== 'active') return 'inactive';
  if (rule.startsAt && now < rule.startsAt) return 'not_started';
  if (rule.endsAt && now >= rule.endsAt) return 'ended';
  return 'live';
}

export function targetLines(rule: Pick<DiscountRule, 'appliesTo' | 'targetIds'>, lines: readonly DiscountCartLine[]): DiscountCartLine[] {
  const ids = new Set(rule.targetIds);
  switch (rule.appliesTo) {
    case 'order':
      return [...lines];
    case 'products':
      return lines.filter((l) => ids.has(l.productId));
    case 'collection':
      return lines.filter((l) => l.collectionIds?.some((id) => ids.has(id)));
    case 'tags':
      return lines.filter((l) => l.tagIds?.some((id) => ids.has(id)));
  }
}

function customerEligible(rule: DiscountRule, customer: DiscountCustomer | null): boolean {
  if (rule.customerEligibility === 'all') return true;
  if (!customer) return false;
  if (rule.customerEligibility === 'first_order') return customer.isFirstOrder;
  return rule.segmentId !== null && customer.segmentIds.includes(rule.segmentId);
}

/**
 * Splits `amount` over lines in proportion to their value (largest remainder), never more than a line holds.
 * Percent rules call it with the rounded percent of the target total, so the receipt shows one rounding.
 */
export function allocate(amount: number, lines: readonly { lineId: string; valuePaise: number }[]): { lineId: string; amountPaise: Paise }[] {
  const total = lines.reduce((s, l) => s + l.valuePaise, 0);
  const take = Math.min(Math.max(0, Math.round(amount)), total);
  if (!take) return [];
  const shares = lines.map((l) => {
    const exact = (take * l.valuePaise) / total;
    return { lineId: l.lineId, floor: Math.floor(exact), rest: exact - Math.floor(exact) };
  });
  let left = take - shares.reduce((s, x) => s + x.floor, 0);
  for (const s of [...shares].sort((a, b) => b.rest - a.rest)) {
    if (left <= 0) break;
    s.floor += 1;
    left -= 1;
  }
  return shares.filter((s) => s.floor > 0).map((s) => ({ lineId: s.lineId, amountPaise: asPaise(s.floor) }));
}

/** Whether a rule applies to this cart now, and if so its amount allocated to lines. */
export function evaluate(rule: DiscountRule, cart: DiscountCart, now: Date): Evaluation {
  const state = windowState(rule, now);
  if (state !== 'live') return { ok: false, reason: state };
  if (!customerEligible(rule, cart.customer)) return { ok: false, reason: 'not_eligible' };
  const lines = targetLines(rule, cart.lines);
  if (!lines.length) return { ok: false, reason: 'no_matching_items' };
  const qty = lines.reduce((s, l) => s + l.qty, 0);
  if (rule.minQty && qty < rule.minQty) return { ok: false, reason: 'min_qty', shortBy: rule.minQty - qty };
  const valued = lines.map((l) => ({ lineId: l.lineId, valuePaise: l.unitPaise * l.qty }));
  const subtotal = valued.reduce((s, l) => s + l.valuePaise, 0);
  if (rule.minSubtotalPaise && subtotal < rule.minSubtotalPaise) return { ok: false, reason: 'min_subtotal', shortBy: rule.minSubtotalPaise - subtotal };
  const amount = rule.valueType === 'percent' ? Math.round((subtotal * rule.value) / 100) : rule.value;
  const allocations = allocate(amount, valued);
  const amountPaise = asPaise(allocations.reduce((s, a) => s + a.amountPaise, 0));
  return {
    ok: true,
    amountPaise,
    discount: { id: rule.id, kind: rule.kind === 'code' ? 'coupon' : 'automatic', label: rule.descriptionPublic || rule.name, stackable: rule.stackable, allocations },
  };
}

/**
 * Automatic promos for a cart (A8): every stackable promo that applies, plus the single best
 * non-stackable one (largest amount, then priority, then id). core.computeTotals then decides the
 * coupon against the non-stackable promo (best-of).
 */
export function selectPromos(rules: readonly DiscountRule[], cart: DiscountCart, now: Date): AppliedDiscountInput[] {
  const hits = rules
    .filter((r) => r.kind === 'automatic')
    .map((r) => ({ rule: r, e: evaluate(r, cart, now) }))
    .filter((x): x is { rule: DiscountRule; e: Extract<Evaluation, { ok: true }> } => x.e.ok && x.e.amountPaise > 0);
  const best = hits
    .filter((x) => !x.rule.stackable)
    .sort((a, b) => b.e.amountPaise - a.e.amountPaise || b.rule.priority - a.rule.priority || a.rule.id.localeCompare(b.rule.id))[0];
  return hits.filter((x) => x.rule.stackable || x === best).sort((a, b) => b.rule.priority - a.rule.priority).map((x) => x.e.discount);
}

// ---- codes -----------------------------------------------------------------

export const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,39}$/;

/** Customer-typed code to its stored form, or null when it cannot be a code (no lookup needed). */
export function normaliseCode(input: string): string | null {
  const code = input.trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

/** Random codes without look-alike characters (no 0/O, 1/I/L). */
export function generateCodes(count: number, options: { prefix?: string; length?: number; random?: (n: number) => Uint8Array } = {}): string[] {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const length = options.length ?? 8;
  const random = options.random ?? ((n: number) => crypto.getRandomValues(new Uint8Array(n)));
  const out = new Set<string>();
  while (out.size < count) {
    const bytes = random(length);
    out.add(`${options.prefix ?? ''}${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')}`);
  }
  return [...out];
}

// ---- IST ---------------------------------------------------------------------

const IST_OFFSET = '+05:30';

/** Admin `datetime-local` value, read as India time ("2026-10-31T23:59" is 18:29 UTC). Empty is null. */
export function istLocalToDate(value: string): Date | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return new Date(Number.NaN);
  return new Date(`${value}:00${IST_OFFSET}`);
}

/** An instant as an IST `datetime-local` value, for form defaults and admin lists. */
export function toIstLocal(date: Date | null): string {
  if (!date) return '';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

// ---- admin input ---------------------------------------------------------------

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const intOrNull = (v: unknown) => (text(v) === '' ? null : /^\d+$/.test(text(v)) ? Number(text(v)) : Number.NaN);
const rupeesOrNull = (v: unknown) => (text(v) === '' ? null : /^\d+(\.\d{1,2})?$/.test(text(v)) ? paise(Number(text(v))) : Number.NaN);
const validDate = z.date().refine((d) => !Number.isNaN(d.getTime()), 'Use a date and time');
const count = z.number().int().positive().nullable();

/** A rule as the admin saves it (instants and paise). */
export const ruleInputSchema = z
  .object({
    id: z.uuid().nullable(),
    name: z.string().min(2).max(120),
    kind: z.enum(['automatic', 'code']),
    status: z.enum(['draft', 'active', 'paused', 'archived']),
    startsAt: validDate.nullable(),
    endsAt: validDate.nullable(),
    valueType: z.enum(['percent', 'fixed']),
    value: z.number().int().positive(),
    appliesTo: z.enum(['order', 'collection', 'products', 'tags']),
    targetIds: z.array(z.string().min(1).max(64)).max(500),
    minQty: count,
    minSubtotalPaise: count,
    customerEligibility: z.enum(['all', 'segment', 'first_order']),
    segmentId: z.string().max(120).nullable(),
    usageLimitTotal: count,
    usageLimitPerCustomer: count,
    stackable: z.boolean(),
    priority: z.number().int().min(-1000).max(1000),
    descriptionPublic: z.string().max(160).nullable(),
  })
  .superRefine((r, ctx) => {
    if (r.valueType === 'percent' && r.value > 100) ctx.addIssue({ code: 'custom', path: ['value'], message: 'A percent is at most 100' });
    if (r.startsAt && r.endsAt && r.endsAt <= r.startsAt) ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'Ends must be after starts' });
    if (r.appliesTo !== 'order' && !r.targetIds.length) ctx.addIssue({ code: 'custom', path: ['targetIds'], message: 'Pick at least one target' });
    if (r.customerEligibility === 'segment' && !r.segmentId) ctx.addIssue({ code: 'custom', path: ['segmentId'], message: 'Pick a segment' });
  });

export type RuleInput = z.output<typeof ruleInputSchema>;

/** The admin form (IST datetime-local, rupees for fixed amounts and minimum subtotal) to `RuleInput`. */
export const ruleFormSchema = z
  .record(z.string(), z.unknown())
  .transform((f) => {
    const valueType = text(f.valueType);
    return {
      id: text(f.id) || null,
      name: text(f.name),
      kind: text(f.kind),
      status: text(f.status) || 'draft',
      startsAt: istLocalToDate(text(f.startsAt)),
      endsAt: istLocalToDate(text(f.endsAt)),
      valueType,
      value: valueType === 'fixed' ? rupeesOrNull(f.value) : intOrNull(f.value),
      appliesTo: text(f.appliesTo) || 'order',
      targetIds: text(f.targetIds).split(/[\s,]+/).filter(Boolean),
      minQty: intOrNull(f.minQty),
      minSubtotalPaise: rupeesOrNull(f.minSubtotal),
      customerEligibility: text(f.customerEligibility) || 'all',
      segmentId: text(f.segmentId) || null,
      usageLimitTotal: intOrNull(f.usageLimitTotal),
      usageLimitPerCustomer: intOrNull(f.usageLimitPerCustomer),
      stackable: f.stackable === 'on' || f.stackable === 'true',
      priority: text(f.priority) === '' ? 0 : Number(text(f.priority)),
      descriptionPublic: text(f.descriptionPublic) || null,
    };
  })
  .pipe(ruleInputSchema);
