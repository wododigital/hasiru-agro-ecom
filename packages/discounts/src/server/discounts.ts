// Discounts server API. No `server-only` import here (the worker loads the event handlers under plain
// Node); `./index.ts` adds the guard for app code.
import { createHmac } from 'node:crypto';
import { and, asc, count, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { audit } from '@ecomkit/core/audit';
import { NotFoundError } from '@ecomkit/core/auth-context';
import { invalidateTags, tags } from '@ecomkit/core/cache-tags';
import type { AppliedDiscountInput, Paise } from '@ecomkit/core/contracts';
import { db, withTx, type DbOrTx, type Tx } from '@ecomkit/core/db';
import { derivedSecret } from '@ecomkit/core/http';
import { normalisePhone } from '@ecomkit/core/ids';
import { rateLimit } from '@ecomkit/core/rate-limit';
import {
  evaluate,
  generateCodes,
  normaliseCode,
  ruleInputSchema,
  selectPromos,
  windowState,
  type DiscountCart,
  type DiscountRule,
  type IneligibleReason,
  type RuleInput,
} from '../domain';
import { discountsCode, discountsRedemption, discountsRule, type DiscountRuleRow } from '../schema';

/** Coupon entry attempts allowed per subject (cart, phone or IP hash) per window. */
export const COUPON_ATTEMPT_LIMIT = 10;
export const COUPON_ATTEMPT_WINDOW_SEC = 15 * 60;

/**
 * Salted, non-reversible phone for usage limits and single-use codes.
 * ponytail: local helper until core owns one phone hash for every module (request in BUILD-STATUS/wp-06.md).
 */
export function hashPhone(phone: string): string {
  return createHmac('sha256', derivedSecret('phone-hash'))
    .update(normalisePhone(phone) ?? phone.trim())
    .digest('base64url')
    .slice(0, 22);
}

const toRule = (r: DiscountRuleRow): DiscountRule => r;

async function liveRules(kind: 'automatic' | 'code', now: Date, conn: DbOrTx = db): Promise<DiscountRule[]> {
  const at = now.toISOString();
  const rows = await conn
    .select()
    .from(discountsRule)
    .where(
      and(
        eq(discountsRule.kind, kind),
        eq(discountsRule.status, 'active'),
        sql`(${discountsRule.startsAt} is null or ${discountsRule.startsAt} <= ${at}::timestamptz)`,
        sql`(${discountsRule.endsAt} is null or ${discountsRule.endsAt} > ${at}::timestamptz)`,
      ),
    );
  return rows.map(toRule);
}

/** Automatic promos that apply to the cart now (A8 selection; computeTotals settles the coupon). */
export async function applicablePromos(cart: DiscountCart, options: { now?: Date } = {}): Promise<AppliedDiscountInput[]> {
  const now = options.now ?? new Date();
  return selectPromos(await liveRules('automatic', now), cart, now);
}

export type CouponResult =
  | { ok: true; code: string; ruleId: string; codeId: string; amountPaise: Paise; discount: AppliedDiscountInput }
  | { ok: false; reason: 'rate_limited' | 'invalid' | 'limit_reached' | Exclude<IneligibleReason, 'inactive' | 'not_started' | 'ended'>; shortBy?: number };

async function usage(ruleId: string, who: { phoneHash: string | null; customerId: string | null }, excludeOrderId: string | null, conn: DbOrTx) {
  const notThisOrder = excludeOrderId ? ne(discountsRedemption.orderId, excludeOrderId) : undefined;
  const [total] = await conn.select({ n: count() }).from(discountsRedemption).where(and(eq(discountsRedemption.ruleId, ruleId), notThisOrder));
  const mine = [who.phoneHash ? eq(discountsRedemption.phoneHash, who.phoneHash) : undefined, who.customerId ? eq(discountsRedemption.customerId, who.customerId) : undefined].filter(Boolean);
  const [customer] = mine.length
    ? await conn.select({ n: count() }).from(discountsRedemption).where(and(eq(discountsRedemption.ruleId, ruleId), notThisOrder, or(...mine)))
    : [{ n: 0 }];
  return { total: total!.n, customer: customer!.n };
}

/**
 * Checks a code the customer typed against the cart. Every attempt counts against `subject`
 * (COUPON_ATTEMPT_LIMIT per window) before any lookup. Unknown, expired, paused and
 * other-customer codes all answer `invalid`, so guessing learns nothing.
 */
export async function applyCoupon(
  input: string,
  cart: DiscountCart,
  options: { subject: string; phone?: string | null; customerId?: string | null; now?: Date },
): Promise<CouponResult> {
  const now = options.now ?? new Date();
  const limit = await rateLimit(`coupon-apply:${options.subject}`, { limit: COUPON_ATTEMPT_LIMIT, windowSec: COUPON_ATTEMPT_WINDOW_SEC, now });
  if (!limit.ok) return { ok: false, reason: 'rate_limited' };
  const code = normaliseCode(input);
  if (!code) return { ok: false, reason: 'invalid' };

  const [hit] = await db.select().from(discountsCode).innerJoin(discountsRule, eq(discountsCode.ruleId, discountsRule.id)).where(eq(discountsCode.code, code));
  if (!hit || hit.discounts_rule.kind !== 'code') return { ok: false, reason: 'invalid' };
  const { discounts_code: c, discounts_rule: rule } = hit;
  if (windowState(rule, now) !== 'live' || (c.expiresAt && now >= c.expiresAt)) return { ok: false, reason: 'invalid' };
  const phoneHash = options.phone ? hashPhone(options.phone) : null;
  if (c.singleUsePhoneHash && c.singleUsePhoneHash !== phoneHash) return { ok: false, reason: 'invalid' };

  const used = await usage(rule.id, { phoneHash, customerId: options.customerId ?? null }, null, db);
  if (rule.usageLimitTotal !== null && used.total >= rule.usageLimitTotal) return { ok: false, reason: 'limit_reached' };
  if (rule.usageLimitPerCustomer !== null && used.customer >= rule.usageLimitPerCustomer) return { ok: false, reason: 'limit_reached' };
  if (c.singleUsePhoneHash) {
    const [u] = await db.select({ n: count() }).from(discountsRedemption).where(eq(discountsRedemption.codeId, c.id));
    if (u!.n > 0) return { ok: false, reason: 'limit_reached' };
  }

  const e = evaluate(toRule(rule), cart, now);
  if (!e.ok) return { ok: false, reason: e.reason === 'inactive' || e.reason === 'not_started' || e.reason === 'ended' ? 'invalid' : e.reason, ...(e.shortBy ? { shortBy: e.shortBy } : {}) };
  return { ok: true, code, ruleId: rule.id, codeId: c.id, amountPaise: e.amountPaise, discount: e.discount };
}

export type RedemptionFailure = 'invalid' | 'not_live' | 'limit_reached' | 'customer_limit_reached' | 'code_used';

export class RedemptionError extends Error {
  constructor(
    readonly ruleId: string,
    readonly reason: RedemptionFailure,
  ) {
    super(`discount ${ruleId} cannot be redeemed: ${reason}`);
    this.name = 'RedemptionError';
  }
}

export interface RedeemInput {
  orderId: string;
  customerId?: string | null;
  phone?: string | null;
  /** The discounts that actually applied (computeTotals' appliedDiscounts, with the rule and code ids). */
  discounts: readonly { ruleId: string; codeId?: string | null; amountPaise: number }[];
}

/**
 * Records the discounts used by an order inside the order's transaction. The rule rows are locked
 * (FOR UPDATE, in id order) so concurrent orders cannot both take the last use; limits are checked
 * under that lock. Throws RedemptionError (the caller rolls back and re-quotes). Idempotent per
 * (order, rule): a retried place-order inserts nothing new.
 */
export async function redeem(input: RedeemInput, options: { tx: Tx; now?: Date }): Promise<void> {
  if (!input.discounts.length) return;
  const { tx } = options;
  const now = options.now ?? new Date();
  const phoneHash = input.phone ? hashPhone(input.phone) : null;
  const customerId = input.customerId ?? null;
  const ids = [...new Set(input.discounts.map((d) => d.ruleId))].sort();
  const rules = await tx.select().from(discountsRule).where(inArray(discountsRule.id, ids)).orderBy(asc(discountsRule.id)).for('update');

  for (const d of input.discounts) {
    const rule = rules.find((r) => r.id === d.ruleId);
    if (!rule) throw new RedemptionError(d.ruleId, 'invalid');
    if (windowState(rule, now) !== 'live') throw new RedemptionError(rule.id, 'not_live');
    if (rule.kind === 'code') {
      if (!d.codeId) throw new RedemptionError(rule.id, 'invalid');
      const [c] = await tx.select().from(discountsCode).where(and(eq(discountsCode.id, d.codeId), eq(discountsCode.ruleId, rule.id)));
      if (!c) throw new RedemptionError(rule.id, 'invalid');
      if (c.expiresAt && now >= c.expiresAt) throw new RedemptionError(rule.id, 'not_live');
      if (c.singleUsePhoneHash) {
        if (c.singleUsePhoneHash !== phoneHash) throw new RedemptionError(rule.id, 'invalid');
        const [u] = await tx.select({ n: count() }).from(discountsRedemption).where(and(eq(discountsRedemption.codeId, c.id), ne(discountsRedemption.orderId, input.orderId)));
        if (u!.n > 0) throw new RedemptionError(rule.id, 'code_used');
      }
    }
    const used = await usage(rule.id, { phoneHash, customerId }, input.orderId, tx);
    if (rule.usageLimitTotal !== null && used.total >= rule.usageLimitTotal) throw new RedemptionError(rule.id, 'limit_reached');
    if (rule.usageLimitPerCustomer !== null) {
      if (!phoneHash && !customerId) throw new RedemptionError(rule.id, 'invalid');
      if (used.customer >= rule.usageLimitPerCustomer) throw new RedemptionError(rule.id, 'customer_limit_reached');
    }
    await tx
      .insert(discountsRedemption)
      .values({ ruleId: rule.id, codeId: d.codeId ?? null, orderId: input.orderId, customerId, phoneHash, amountPaise: d.amountPaise })
      .onConflictDoNothing({ target: [discountsRedemption.orderId, discountsRedemption.ruleId] });
  }
}

/** Frees an order's uses (cancelled or payment failed), so the limits count only real orders. */
export async function releaseRedemptions(orderId: string, conn: DbOrTx = db): Promise<number> {
  const res = await conn.delete(discountsRedemption).where(eq(discountsRedemption.orderId, orderId));
  return res.rowCount ?? 0;
}

// ---- admin -----------------------------------------------------------------

export interface RuleListRow extends DiscountRule {
  createdAt: Date;
  uses: number;
  codes: number;
}

export async function listRules(): Promise<RuleListRow[]> {
  const uses = db.select({ ruleId: discountsRedemption.ruleId, n: count().as('uses') }).from(discountsRedemption).groupBy(discountsRedemption.ruleId).as('u');
  const codes = db.select({ ruleId: discountsCode.ruleId, n: count().as('codes') }).from(discountsCode).groupBy(discountsCode.ruleId).as('c');
  const rows = await db
    .select({ rule: discountsRule, uses: uses.n, codes: codes.n })
    .from(discountsRule)
    .leftJoin(uses, eq(uses.ruleId, discountsRule.id))
    .leftJoin(codes, eq(codes.ruleId, discountsRule.id))
    .orderBy(desc(discountsRule.createdAt), desc(discountsRule.id));
  return rows.map((r) => ({ ...r.rule, uses: Number(r.uses ?? 0), codes: Number(r.codes ?? 0) }));
}

export interface RuleDetail {
  rule: DiscountRuleRow;
  codes: { id: string; code: string; singleUse: boolean; expiresAt: Date | null; uses: number }[];
}

export async function getRule(id: string): Promise<RuleDetail | null> {
  const [rule] = await db.select().from(discountsRule).where(eq(discountsRule.id, id));
  if (!rule) return null;
  const codes = await db
    .select({ id: discountsCode.id, code: discountsCode.code, single: discountsCode.singleUsePhoneHash, expiresAt: discountsCode.expiresAt, uses: count(discountsRedemption.id) })
    .from(discountsCode)
    .leftJoin(discountsRedemption, eq(discountsRedemption.codeId, discountsCode.id))
    .where(eq(discountsCode.ruleId, id))
    .groupBy(discountsCode.id)
    .orderBy(asc(discountsCode.code))
    .limit(500);
  return { rule, codes: codes.map((c) => ({ id: c.id, code: c.code, singleUse: c.single !== null, expiresAt: c.expiresAt, uses: c.uses })) };
}

/** Creates or updates a rule (validated here), audited, and expires the `promo:active` tag. Permission is the caller's job. */
export async function saveRule(input: RuleInput, actor: { actorId: string | null }): Promise<{ id: string }> {
  const { id, ...values } = ruleInputSchema.parse(input);
  const saved = await withTx(async (tx) => {
    if (id) {
      const [before] = await tx.select().from(discountsRule).where(eq(discountsRule.id, id)).for('update');
      if (!before) throw new NotFoundError();
      const [after] = await tx.update(discountsRule).set({ ...values, updatedAt: new Date() }).where(eq(discountsRule.id, id)).returning();
      await audit({ actorId: actor.actorId, actorType: 'staff', action: 'discount.update', entity: 'discount', entityId: id, before, after }, { tx });
      return after!;
    }
    const [after] = await tx.insert(discountsRule).values(values).returning();
    await audit({ actorId: actor.actorId, actorType: 'staff', action: 'discount.create', entity: 'discount', entityId: after!.id, after }, { tx });
    return after!;
  });
  await invalidateTags([tags.promoActive]);
  return { id: saved.id };
}

/**
 * Adds codes to a `kind = code` rule. Codes are normalised to upper case; a code that already exists
 * anywhere is skipped and reported. Pass `singleUsePhone` to pin a code to one customer (one use).
 */
export async function addCodes(
  ruleId: string,
  codes: readonly string[],
  actor: { actorId: string | null; actorType?: 'staff' | 'system' },
  options: { singleUsePhone?: string; expiresAt?: Date | null } = {},
): Promise<{ added: string[]; skipped: string[] }> {
  const normalised = codes.map((c) => ({ raw: c, code: normaliseCode(c) }));
  const bad = normalised.filter((c) => !c.code).map((c) => c.raw);
  if (bad.length) throw new RangeError(`not a valid code: ${bad.join(', ')}`);
  const wanted = [...new Set(normalised.map((c) => c.code!))];
  const singleUsePhoneHash = options.singleUsePhone ? hashPhone(options.singleUsePhone) : null;
  return withTx(async (tx) => {
    const [rule] = await tx.select({ kind: discountsRule.kind }).from(discountsRule).where(eq(discountsRule.id, ruleId));
    if (!rule) throw new NotFoundError();
    if (rule.kind !== 'code') throw new RangeError('only code discounts have codes');
    const inserted = wanted.length
      ? await tx
          .insert(discountsCode)
          .values(wanted.map((code) => ({ ruleId, code, singleUsePhoneHash, expiresAt: options.expiresAt ?? null })))
          .onConflictDoNothing({ target: discountsCode.code })
          .returning({ code: discountsCode.code })
      : [];
    const added = inserted.map((r) => r.code);
    if (added.length)
      await audit({ actorId: actor.actorId, actorType: actor.actorType ?? 'staff', action: 'discount.codes_add', entity: 'discount', entityId: ruleId, after: { codes: added, singleUse: !!singleUsePhoneHash } }, { tx });
    return { added, skipped: wanted.filter((c) => !added.includes(c)) };
  });
}

/** One personal code for one customer (e.g. a follow-up message offer). Returns the code to send. */
export async function createSingleUseCode(options: { ruleId: string; phone: string; expiresAt?: Date | null; prefix?: string }): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const [code] = generateCodes(1, { prefix: options.prefix ?? '' });
    const { added } = await addCodes(options.ruleId, [code!], { actorId: null, actorType: 'system' }, { singleUsePhone: options.phone, expiresAt: options.expiresAt ?? null });
    if (added.length) return added[0]!;
  }
  throw new Error('could not generate a unique code');
}
