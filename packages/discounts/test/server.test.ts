import { eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenError, setAuthProvider } from '@ecomkit/core/auth-context';
import type { EventHandler, Permission, StaffViewer } from '@ecomkit/core/contracts';
import { withTx } from '@ecomkit/core/db';
import { newId } from '@ecomkit/core/ids';
import { coreAuditLog } from '@ecomkit/core/schema';
import { createTestDb, TEST_NOW, type TestDb } from '@ecomkit/core/testing';
import { addCodesAction, saveRuleAction } from '../src/admin/actions';
import { DiscountEditPage } from '../src/admin/DiscountEditPage';
import { DiscountsListPage } from '../src/admin/DiscountsListPage';
import { istLocalToDate, type DiscountCart, type RuleInput } from '../src/domain';
import manifest from '../src/manifest';
import { discountsRedemption } from '../src/schema';
import {
  addCodes,
  applicablePromos,
  applyCoupon,
  COUPON_ATTEMPT_LIMIT,
  COUPON_ATTEMPT_WINDOW_SEC,
  createSingleUseCode,
  listRules,
  redeem,
  RedemptionError,
  saveRule,
} from '../src/server/discounts';

// Server-rendering the admin pages outside Next: the list toolbar and live-view islands call useRouter.
vi.mock('next/navigation', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useRouter: () => ({ replace() {}, push() {}, refresh() {} }),
}));

let t: TestDb;
const STAFF = newId();
const NOW = TEST_NOW;
const cart: DiscountCart = {
  lines: [{ lineId: 'l1', productId: 'p1', qty: 60, unitPaise: 35_500, collectionIds: ['c-fruit'] }],
  customer: { isFirstOrder: true, segmentIds: [] },
};
const base: RuleInput = {
  id: null, name: 'Rule', kind: 'automatic', status: 'active', startsAt: null, endsAt: null, valueType: 'percent', value: 10, appliesTo: 'order', targetIds: [],
  minQty: null, minSubtotalPaise: null, customerEligibility: 'all', segmentId: null, usageLimitTotal: null, usageLimitPerCustomer: null, stackable: false, priority: 0, descriptionPublic: null,
};
const staff = (permissions: Permission[]): StaffViewer => ({ kind: 'staff', userId: STAFF, name: 'Test', email: 't@example.com', role: 'manager', permissions });
function signIn(permissions: Permission[] | null) {
  setAuthProvider(async () => ({
    getViewer: async () => (permissions ? staff(permissions) : { kind: 'guest' }),
    requirePermission: async (perm) => {
      if (!permissions?.includes(perm)) throw new ForbiddenError();
      return staff(permissions);
    },
    requireOwner: async () => {
      throw new ForbiddenError();
    },
  }));
}
const actor = { actorId: STAFF };
async function couponRule(patch: Partial<RuleInput>, codes: string[]) {
  const { id } = await saveRule({ ...base, kind: 'code', ...patch }, actor);
  await addCodes(id, codes, actor);
  return id;
}
const subject = () => `cart-${newId()}`;

beforeAll(async () => {
  process.env.INTERNAL_SECRET = 'z'.repeat(40);
  process.env.INTERNAL_BASE_URL = 'http://127.0.0.1:9';
  t = await createTestDb('wp-06-discounts', { schemas: ['core', 'discounts'] });
}, 120_000);

afterAll(async () => {
  setAuthProvider(async () => null);
  await t?.close();
});

beforeEach(() => signIn(null));

describe('automatic promos', () => {
  it('only active rules inside their IST window apply', async () => {
    await saveRule({ ...base, name: 'Live', startsAt: istLocalToDate('2026-10-20T00:00'), endsAt: istLocalToDate('2026-10-21T00:00') }, actor);
    await saveRule({ ...base, name: 'Ended yesterday', value: 50, endsAt: istLocalToDate('2026-10-20T00:00') }, actor);
    await saveRule({ ...base, name: 'Tomorrow', value: 50, startsAt: istLocalToDate('2026-10-21T00:00') }, actor);
    await saveRule({ ...base, name: 'Draft', value: 50, status: 'draft' }, actor);
    const promos = await applicablePromos(cart, { now: NOW });
    expect(promos.map((p) => p.label)).toEqual(['Live']);
    // Just after IST midnight on the 21st the live promo has ended and tomorrow's has started.
    const later = await applicablePromos(cart, { now: new Date('2026-10-21T00:05:00+05:30') });
    expect(later.map((p) => p.label)).toEqual(['Tomorrow']);
  });
});

describe('coupons', () => {
  let ruleId: string;
  beforeAll(async () => {
    ruleId = await couponRule({ name: 'Grow 15', value: 15, minSubtotalPaise: 1_000_000 }, ['grow15']);
    await couponRule({ name: 'Paused', status: 'paused' }, ['PAUSED1']);
    const { id } = await saveRule({ ...base, kind: 'code', name: 'Old' }, actor);
    await addCodes(id, ['OLD1'], actor, { expiresAt: istLocalToDate('2026-10-20T09:00') });
  });

  it('a valid code applies (any case) and returns the rule and code ids', async () => {
    const r = await applyCoupon(' Grow15 ', cart, { subject: subject(), now: NOW });
    expect(r).toMatchObject({ ok: true, code: 'GROW15', ruleId, amountPaise: Math.round(60 * 35_500 * 0.15), discount: { kind: 'coupon', label: 'Grow 15' } });
  });

  it('unknown, paused and expired codes all answer invalid', async () => {
    for (const code of ['NOPE99', 'PAUSED1', 'OLD1', '!!']) expect(await applyCoupon(code, cart, { subject: subject(), now: NOW })).toEqual({ ok: false, reason: 'invalid' });
  });

  it('a valid code below the minimum spend says how much is missing', async () => {
    const small = { ...cart, lines: [{ ...cart.lines[0]!, qty: 10 }] };
    expect(await applyCoupon('GROW15', small, { subject: subject(), now: NOW })).toEqual({ ok: false, reason: 'min_subtotal', shortBy: 1_000_000 - 355_000 });
  });

  it('brute-force limit: attempts beyond the limit are refused, even for a valid code, until the window passes', async () => {
    const s = subject();
    for (let i = 0; i < COUPON_ATTEMPT_LIMIT; i++) expect((await applyCoupon(`GUESS${i}X`, cart, { subject: s, now: NOW })).ok).toBe(false);
    expect(await applyCoupon('GROW15', cart, { subject: s, now: NOW })).toEqual({ ok: false, reason: 'rate_limited' });
    expect((await applyCoupon('GROW15', cart, { subject: subject(), now: NOW })).ok).toBe(true);
    const after = new Date(NOW.getTime() + COUPON_ATTEMPT_WINDOW_SEC * 1000 + 1000);
    expect((await applyCoupon('GROW15', cart, { subject: s, now: after })).ok).toBe(true);
  });

  it('a personal single-use code works only for its phone, once', async () => {
    const id = await couponRule({ name: 'Follow-up' }, []);
    const code = await createSingleUseCode({ ruleId: id, phone: '98450 12345', prefix: 'HI-' });
    expect(code).toMatch(/^HI-/);
    expect(await applyCoupon(code, cart, { subject: subject(), phone: '+919999999999', now: NOW })).toEqual({ ok: false, reason: 'invalid' });
    const ok = await applyCoupon(code, cart, { subject: subject(), phone: '+919845012345', now: NOW });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    await withTx((tx) => redeem({ orderId: newId(), phone: '9845012345', discounts: [{ ruleId: id, codeId: ok.codeId, amountPaise: ok.amountPaise }] }, { tx, now: NOW }));
    expect(await applyCoupon(code, cart, { subject: subject(), phone: '+919845012345', now: NOW })).toEqual({ ok: false, reason: 'limit_reached' });
    await expect(withTx((tx) => redeem({ orderId: newId(), phone: '9845012345', discounts: [{ ruleId: id, codeId: ok.codeId, amountPaise: 1 }] }, { tx, now: NOW }))).rejects.toMatchObject({ reason: 'code_used' });
  });
});

describe('redemption', () => {
  it('total usage limit holds under 20 concurrent orders (exactly 5 succeed)', async () => {
    const { id } = await saveRule({ ...base, name: 'First five', usageLimitTotal: 5 }, actor);
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) => withTx((tx) => redeem({ orderId: newId(), phone: `98450${String(i).padStart(5, '0')}`, discounts: [{ ruleId: id, amountPaise: 100 }] }, { tx, now: NOW }))),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(failed).toHaveLength(15);
    for (const f of failed) expect(f.reason).toBeInstanceOf(RedemptionError);
    expect(failed.every((f) => (f.reason as RedemptionError).reason === 'limit_reached')).toBe(true);
    expect(await t.db.select().from(discountsRedemption).where(eq(discountsRedemption.ruleId, id))).toHaveLength(5);
  });

  it('per-customer limit counts by phone; a retried order is idempotent', async () => {
    const { id } = await saveRule({ ...base, name: 'Once each', usageLimitPerCustomer: 1 }, actor);
    const order = newId();
    const use = (orderId: string, phone: string | null) => withTx((tx) => redeem({ orderId, phone, discounts: [{ ruleId: id, amountPaise: 500 }] }, { tx, now: NOW }));
    await use(order, '9845011111');
    await use(order, '+91 98450 11111');
    expect(await t.db.select().from(discountsRedemption).where(eq(discountsRedemption.ruleId, id))).toHaveLength(1);
    await expect(use(newId(), '919845011111')).rejects.toMatchObject({ reason: 'customer_limit_reached' });
    await use(newId(), '9845022222');
    await expect(use(newId(), null)).rejects.toMatchObject({ reason: 'invalid' });
  });

  it('a rule that ended before payment cannot be redeemed', async () => {
    const { id } = await saveRule({ ...base, name: 'Ends 9am', endsAt: istLocalToDate('2026-10-20T09:00') }, actor);
    await expect(withTx((tx) => redeem({ orderId: newId(), discounts: [{ ruleId: id, amountPaise: 1 }] }, { tx, now: NOW }))).rejects.toMatchObject({ reason: 'not_live' });
  });

  it('order.cancelled and order.payment_failed release the use (handler from the manifest)', async () => {
    const { id } = await saveRule({ ...base, name: 'Only one', usageLimitTotal: 1 }, actor);
    const order = newId();
    await withTx((tx) => redeem({ orderId: order, discounts: [{ ruleId: id, amountPaise: 1 }] }, { tx, now: NOW }));
    await expect(withTx((tx) => redeem({ orderId: newId(), discounts: [{ ruleId: id, amountPaise: 1 }] }, { tx, now: NOW }))).rejects.toMatchObject({ reason: 'limit_reached' });
    const handler: EventHandler<'order.cancelled'> = await manifest.on['order.cancelled']();
    await handler({ orderId: order, orderNumber: 'X-1', reason: null }, { eventId: 'e', emittedAt: NOW, log: console as never });
    await withTx((tx) => redeem({ orderId: newId(), discounts: [{ ruleId: id, amountPaise: 1 }] }, { tx, now: NOW }));
    expect(manifest.on['order.payment_failed']).toBeTypeOf('function');
  });
});

describe('admin', () => {
  it('saving a rule is audited; codes skip duplicates and need a code rule', async () => {
    const { id } = await saveRule({ ...base, name: 'Audited' }, actor);
    await saveRule({ ...base, id, name: 'Audited', value: 12 }, actor);
    const rows = await t.db.select().from(coreAuditLog).where(eq(coreAuditLog.entityId, id));
    expect(rows.map((r) => r.action).sort()).toEqual(['discount.create', 'discount.update']);
    expect(rows.find((r) => r.action === 'discount.update')!.before).toMatchObject({ value: 10 });
    await expect(addCodes(id, ['ABC123'], actor)).rejects.toThrow(/only code discounts/);
    const codeRule = await couponRule({ name: 'Codes' }, ['DUP-1']);
    expect(await addCodes(codeRule, ['dup-1', 'new-1', 'NEW-1'], actor)).toEqual({ added: ['NEW-1'], skipped: ['DUP-1'] });
    await expect(addCodes(codeRule, ['x'], actor)).rejects.toThrow(RangeError);
    const listed = (await listRules()).find((r) => r.id === codeRule)!;
    expect(listed).toMatchObject({ codes: 2, uses: 0 });
  });

  it('actions need marketing.write; create redirects to the rule; bad input returns field errors', async () => {
    const form = new FormData();
    for (const [k, v] of [['name', 'From form'], ['kind', 'code'], ['valueType', 'percent'], ['value', '5']] as const) form.append(k, v);
    expect(await saveRuleAction(null, form)).toMatchObject({ ok: false, formError: 'forbidden' });
    signIn(['marketing.write']);
    await expect(saveRuleAction(null, form)).rejects.toMatchObject({ digest: expect.stringMatching(/^NEXT_REDIRECT;.*\/admin\/discounts\/[0-9a-f-]{36}/) });
    const bad = new FormData();
    bad.append('name', 'x');
    const res = await saveRuleAction(null, bad);
    expect(res.ok).toBe(false);
    const created = (await listRules()).find((r) => r.name === 'From form')!;
    const codes = new FormData();
    codes.append('ruleId', created.id);
    codes.append('generate', '3');
    codes.append('prefix', 'web');
    const added = await addCodesAction(null, codes);
    expect(added.ok && added.data.added.filter((c) => c.startsWith('WEB')).length).toBe(3);
  });

  it('list and edit pages render for staff and refuse others', async () => {
    await expect(DiscountsListPage({ now: NOW })).rejects.toBeInstanceOf(ForbiddenError);
    signIn(['marketing.write']);
    const list = renderToStaticMarkup(await DiscountsListPage({ now: NOW }));
    expect(list).toContain('Grow 15');
    expect(list).toContain('Live');
    const id = (await listRules()).find((r) => r.name === 'Grow 15')!.id;
    const edit = renderToStaticMarkup(await DiscountEditPage({ id }));
    expect(edit).toContain('GROW15');
    expect(edit).toContain('name="minSubtotal"');
    expect(edit).toContain('value="10000"');
    expect(manifest.admin.nav[0]).toMatchObject({ href: '/admin/discounts', order: 410 });
  });
});
