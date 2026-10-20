// Real Postgres with the real notifications and customers modules; cart, orders, leads, catalog and discounts are
// in-memory ports (harness). Time is passed in explicitly.
import { newId } from '@ecomkit/core/ids';
import { coreAuditLog } from '@ecomkit/core/schema';
import { createTestDb, queuedJobs, type TestDb } from '@ecomkit/core/testing';
import { recordConsent } from '@ecomkit/customers/server';
import { notificationsMessage, notificationsWebhookEvent } from '@ecomkit/notifications/schema';
import { addressHash, deliver, type DeliverJobData } from '@ecomkit/notifications/server';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { formToSettings } from '../src/admin/form';
import { FLOW_DEFS } from '../src/domain';
import { flowsRun, flowsStep } from '../src/schema';
import { getFlowDetail, listAbandonedCheckouts, listFlowCards, testRun } from '../src/server/admin';
import { backInStockSender, onCartAbandoned, onLeadCreated, onOrderConfirmed, onOrderDelivered, onOrderPlaced, onSlotReminder } from '../src/server/events';
import { getFlowRow, saveFlow } from '../src/server/flows';
import { GET as restoreGet } from '../src/server/restore';
import { configureFlows } from '../src/server/ports';
import { restoreToken, runDue, startFlow, verifyRestoreToken } from '../src/server/runner';
import { bindFakes, cart, createQueues, order, signIn, STAFF, testEnv, type Fakes } from './harness';

let t: TestDb;
let f: Fakes;
const ist = (s: string) => new Date(`${s}+05:30`);
const H = 3_600_000;
let seq = 0;
/** A fresh phone per test, so the 7-day cap of one test never touches another. */
const nextPhone = () => `+9198765${String(10000 + ++seq).slice(-5)}`;

const messagesOf = (runId: string) => t.db.select().from(notificationsMessage).where(eq(notificationsMessage.flowRunId, runId)).orderBy(asc(notificationsMessage.queuedAt));
const runOf = async (id: string) => (await t.db.select().from(flowsRun).where(eq(flowsRun.id, id)))[0]!;

async function consent(phone: string, granted = true) {
  await recordConsent({ subject: { phone }, purpose: 'marketing', granted, textShown: 'Send me offers and cart reminders on WhatsApp and email.', source: 'checkout' });
}

/** Starts an abandoned-cart run for a fresh cart. */
async function abandon(contact: Parameters<typeof cart>[0], at: Date) {
  const cartId = newId();
  f.carts.set(cartId, cart(contact));
  const started = await startFlow('abandoned_cart', { type: 'cart', id: cartId }, { cartId }, { now: at });
  return { cartId, run: started!.run };
}

beforeAll(async () => {
  testEnv();
  t = await createTestDb('wp-22-flows', { schemas: ['core', 'notifications', 'customers', 'flows'] });
  await createQueues();
}, 120_000);

afterAll(async () => {
  await t?.close();
});

beforeEach(async () => {
  f = bindFakes();
  signIn(null);
  // Every test starts from the default settings.
  for (const key of Object.keys(FLOW_DEFS) as (keyof typeof FLOW_DEFS)[]) await saveFlow(key, { status: 'active', settings: FLOW_DEFS[key].defaults }, null);
});

describe('abandoned cart', () => {
  it('without a customer or session contact sends nothing (no_contact)', async () => {
    const { run } = await abandon(null, ist('2026-10-20T08:30:00'));
    expect(run.status).toBe('stopped');
    expect(run.stopReason).toBe('no_contact');
    expect(await messagesOf(run.id)).toHaveLength(0);
    expect(await runDue(ist('2026-10-25T12:00:00'))).toBe(0);
  });

  it('with a contact but no marketing consent sends nothing (no_consent)', async () => {
    const { run } = await abandon({ phone: nextPhone(), name: 'Asha' }, ist('2026-10-20T08:30:00'));
    expect(run.stopReason).toBe('no_consent');
    expect(run.messages).toBe(0);
    expect(await messagesOf(run.id)).toHaveLength(0);
  });

  it('full sequence: quiet hours shift, marketing path, single-use code on the 72 h step, completes after 3 reminders', async () => {
    const phone = nextPhone();
    await consent(phone);
    const rule = '0192a000-0000-7000-8000-0000000000c1';
    await saveFlow('abandoned_cart', { status: 'active', settings: { ...FLOW_DEFS.abandoned_cart.defaults, discountRuleId: rule } }, STAFF.userId);
    const start = ist('2026-10-20T08:30:00');
    const { run } = await abandon({ phone, email: 'asha@example.test', name: 'Asha' }, start);
    expect(run.status).toBe('running');
    // 1 h after 08:30 is 09:30, inside the 09:00-11:00 window, so it waits for 11:00.
    expect(run.nextStepAt).toEqual(ist('2026-10-20T11:00:00'));
    expect(await runDue(ist('2026-10-20T10:59:00'))).toBe(0);

    expect(await runDue(ist('2026-10-20T11:00:00'))).toBeGreaterThanOrEqual(1);
    let msgs = await messagesOf(run.id);
    expect(msgs.map((m) => [m.templateKey, m.channel, m.category])).toEqual([
      ['cart.reminder_1', 'whatsapp', 'marketing'],
      ['cart.reminder_1', 'email', 'marketing'],
    ]);
    const text = (msgs[0]!.rendered as { text: string }).text;
    const link = /https:\/\/shop\.example\.test\/r\/(\S+)/.exec(text)?.[1];
    expect(link && verifyRestoreToken(link)).toBe(run.id);
    expect(text).toContain('Hi Asha');

    // Marketing sends go through the Marketing Messages endpoint (real notifications delivery, captured HTTP).
    const job = (await queuedJobs(t.db, 'notifications.deliver')).find((j) => (j.data as DeliverJobData).messageId === msgs[0]!.id)!;
    const urls: string[] = [];
    await deliver(job.data as DeliverJobData, { attempt: 1 }, {
      http: async (url) => {
        urls.push(url);
        return new Response(JSON.stringify({ messages: [{ id: 'wamid.flows-test' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/\/marketing_messages$/);

    expect((await runOf(run.id)).nextStepAt).toEqual(ist('2026-10-21T08:30:00'));
    await runDue(ist('2026-10-21T08:30:00'));
    // 72 h lands at 08:30 on the 23rd (outside the windows).
    expect((await runOf(run.id)).nextStepAt).toEqual(ist('2026-10-23T08:30:00'));
    await runDue(ist('2026-10-23T08:31:00'));

    msgs = await messagesOf(run.id);
    expect(msgs.map((m) => m.templateKey)).toEqual(['cart.reminder_1', 'cart.reminder_1', 'cart.reminder_2', 'cart.reminder_2', 'cart.reminder_3', 'cart.reminder_3']);
    const done = await runOf(run.id);
    expect(done.status).toBe('completed');
    expect(done.messages).toBe(6);
    // One code for the run, bound to the phone, valid 48 h; the restore link applies it.
    expect(f.codes).toEqual([{ ruleId: rule, phone, expiresAt: new Date(ist('2026-10-23T08:31:00').getTime() + 48 * H) }]);
    expect(done.context.code).toBe('CODE1');
  });

  it('stops on purchase (cart converted at the next step, or eagerly on order.placed)', async () => {
    const phone = nextPhone();
    await consent(phone);
    const a = await abandon({ phone }, ist('2026-10-20T12:00:00'));
    await runDue(ist('2026-10-20T13:00:00'));
    expect(await messagesOf(a.run.id)).toHaveLength(1);
    f.carts.set(a.cartId, cart({ phone }, 'converted'));
    await runDue(ist('2026-10-21T12:00:00'));
    expect(await runOf(a.run.id)).toMatchObject({ status: 'stopped', stopReason: 'purchased', messages: 1 });
    expect(await messagesOf(a.run.id)).toHaveLength(1);

    const phone2 = nextPhone();
    await consent(phone2);
    const b = await abandon({ phone: phone2 }, ist('2026-10-20T12:00:00'));
    const orderId = newId();
    f.orders.set(orderId, order({ phone: phone2 }));
    await onOrderPlaced({ orderId, orderNumber: 'A-1' });
    expect(await runOf(b.run.id)).toMatchObject({ status: 'stopped', stopReason: 'purchased' });
  });

  it('stops on reply (inbound WhatsApp after the start)', async () => {
    const phone = nextPhone();
    await consent(phone);
    const { run } = await abandon({ phone }, ist('2026-10-20T12:00:00'));
    await runDue(ist('2026-10-20T13:00:00'));
    await t.db.insert(notificationsWebhookEvent).values({ provider: 'whatsapp', dedupeKey: `wa:in:${newId()}`, kind: 'inbound', phoneHash: addressHash(phone), payload: {}, receivedAt: ist('2026-10-20T15:00:00') });
    await runDue(ist('2026-10-21T12:00:00'));
    expect(await runOf(run.id)).toMatchObject({ status: 'stopped', stopReason: 'replied', messages: 1 });
  });

  it('stops on unsubscribe (marketing consent revoked)', async () => {
    const phone = nextPhone();
    await consent(phone);
    const { run } = await abandon({ phone }, ist('2026-10-20T12:00:00'));
    await runDue(ist('2026-10-20T13:00:00'));
    await consent(phone, false);
    await runDue(ist('2026-10-21T12:00:00'));
    expect(await runOf(run.id)).toMatchObject({ status: 'stopped', stopReason: 'unsubscribed', messages: 1 });
  });

  it('one sequence per contact per 7 days', async () => {
    const phone = nextPhone();
    await consent(phone);
    const first = await abandon({ phone }, ist('2026-10-01T12:00:00'));
    expect(first.run.status).toBe('running');
    const second = await abandon({ phone }, ist('2026-10-05T12:00:00'));
    expect(second.run).toMatchObject({ status: 'stopped', stopReason: 'frequency_cap' });
    expect(await messagesOf(second.run.id)).toHaveLength(0);
    const third = await abandon({ phone }, ist('2026-10-09T12:00:00'));
    expect(third.run.status).toBe('running');
  });

  it('a paused flow starts nothing; the same cart never runs twice at once', async () => {
    const phone = nextPhone();
    await consent(phone);
    const cartId = newId();
    f.carts.set(cartId, cart({ phone }));
    await onCartAbandoned({ cartId, checkoutSessionId: null });
    await onCartAbandoned({ cartId, checkoutSessionId: null });
    const flow = await getFlowRow('abandoned_cart');
    expect(await t.db.select().from(flowsRun).where(and(eq(flowsRun.flowId, flow.id), eq(flowsRun.subjectId, cartId)))).toHaveLength(1);

    await saveFlow('abandoned_cart', { status: 'paused', settings: FLOW_DEFS.abandoned_cart.defaults }, null);
    const other = newId();
    f.carts.set(other, cart({ phone: nextPhone() }));
    expect(await startFlow('abandoned_cart', { type: 'cart', id: other }, { cartId: other })).toBeNull();
  });

  it('restore link: valid token restores the cart with the code; anything else lands on /cart and restores nothing', async () => {
    const phone = nextPhone();
    await consent(phone);
    const { run, cartId } = await abandon({ phone }, ist('2026-10-20T12:00:00'));
    await t.db.update(flowsRun).set({ context: { cartId, code: 'SAVE5' } }).where(eq(flowsRun.id, run.id));
    const res = await restoreGet(new Request('https://shop.example.test/r/x'), { params: Promise.resolve({ token: restoreToken(run.id) }) });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/cart');
    expect(f.restored).toEqual([{ cartId, couponCode: 'SAVE5' }]);
    expect((await runOf(run.id)).context.restoredAt).toBeTruthy();

    const expired = restoreToken(run.id, new Date(Date.now() - 15 * 24 * 60 * 60 * 1000));
    expect(verifyRestoreToken(expired)).toBeNull();
    for (const token of [`${run.id}.${'0'.repeat(32)}`, 'nope', restoreToken(newId()), expired]) {
      const bad = await restoreGet(new Request('https://shop.example.test/r/x'), { params: Promise.resolve({ token }) });
      expect(bad.status).toBe(303);
    }
    expect(f.restored).toHaveLength(1);

    await t.db.update(flowsRun).set({ status: 'stopped' }).where(eq(flowsRun.id, run.id));
    await restoreGet(new Request('https://shop.example.test/r/x'), { params: Promise.resolve({ token: restoreToken(run.id) }) });
    expect(f.restored).toHaveLength(1);
  });

  it('a failing source marks the run failed instead of retrying forever', async () => {
    const phone = nextPhone();
    await consent(phone);
    const { run } = await abandon({ phone }, ist('2026-10-20T12:00:00'));
    configureFlows({
      carts: {
        snapshot: async () => {
          throw new Error('cart store unavailable');
        },
        restore: async () => false,
      },
    });
    await runDue(ist('2026-10-20T13:00:00'));
    expect(await runOf(run.id)).toMatchObject({ status: 'failed', stopReason: 'error: cart store unavailable' });
  });
});

describe('order updates, slot reminder, review request', () => {
  it('confirmed is sent once even when paid and confirmed both arrive; utility, no consent needed', async () => {
    const orderId = newId();
    f.orders.set(orderId, order({ phone: nextPhone(), name: 'Ravi' }));
    await onOrderConfirmed({ orderId, orderNumber: 'A-1' });
    await onOrderConfirmed({ orderId, orderNumber: 'A-1' });
    const flow = await getFlowRow('order_updates');
    const runs = await t.db.select().from(flowsRun).where(eq(flowsRun.flowId, flow.id));
    const mine = runs.filter((r) => r.context.orderId === orderId);
    expect(mine).toHaveLength(1);
    const msgs = await messagesOf(mine[0]!.id);
    // Both channels by default; the contact has a phone only, so the email row is skipped (no address).
    expect(msgs.map((m) => [m.templateKey, m.channel, m.category])).toEqual([['order.confirmed', 'whatsapp', 'utility']]);
    expect(msgs[0]!.orderId).toBe(orderId);
  });

  it('slot reminder: once per order and slot date', async () => {
    const orderId = newId();
    f.orders.set(orderId, order({ phone: nextPhone() }));
    await onSlotReminder({ orderId, orderNumber: 'A-1', slotDate: '2026-10-24' });
    await onSlotReminder({ orderId, orderNumber: 'A-1', slotDate: '2026-10-24' });
    const flow = await getFlowRow('slot_reminder');
    const runs = (await t.db.select().from(flowsRun).where(eq(flowsRun.flowId, flow.id))).filter((r) => r.context.orderId === orderId);
    expect(runs).toHaveLength(1);
    const msgs = await messagesOf(runs[0]!.id);
    expect(msgs).toHaveLength(1);
    expect((msgs[0]!.rendered as { text: string }).text).toContain('Sat 24 Oct, 9 am to 1 pm');
  });

  it('review request waits 7 days after delivery, needs consent, skips cancelled orders', async () => {
    const phone = nextPhone();
    await consent(phone);
    const orderId = newId();
    f.orders.set(orderId, order({ phone }, { status: 'delivered' }));
    await onOrderDelivered({ orderId, orderNumber: 'A-1' });
    const flow = await getFlowRow('review_request');
    const [run] = (await t.db.select().from(flowsRun).where(eq(flowsRun.flowId, flow.id))).filter((r) => r.context.orderId === orderId);
    expect(run!.status).toBe('running');
    expect(run!.nextStepAt!.getTime() - run!.startedAt.getTime()).toBe(7 * 24 * H);
    await runDue(new Date(run!.startedAt.getTime() + 7 * 24 * H + 1000));
    expect((await messagesOf(run!.id)).map((m) => m.templateKey)).toContain('review.request');

    const cancelledId = newId();
    const p2 = nextPhone();
    await consent(p2);
    f.orders.set(cancelledId, order({ phone: p2 }, { status: 'delivered' }));
    await onOrderDelivered({ orderId: cancelledId, orderNumber: 'A-2' });
    f.orders.set(cancelledId, order({ phone: p2 }, { status: 'refunded' }));
    const [r2] = (await t.db.select().from(flowsRun).where(eq(flowsRun.flowId, flow.id))).filter((r) => r.context.orderId === cancelledId);
    await runDue(new Date(r2!.startedAt.getTime() + 8 * 24 * H));
    expect(await runOf(r2!.id)).toMatchObject({ status: 'stopped', stopReason: 'order_cancelled', messages: 0 });
  });
});

describe('planner lead follow-up and back in stock', () => {
  it('lead follow-up at 48 h when no order; stops if an order came in', async () => {
    const phone = nextPhone();
    await consent(phone);
    const leadId = newId();
    f.leads.set(leadId, { phone, name: 'Mala', link: '/plan/results/p1' });
    await onLeadCreated({ leadId, source: 'enquiry' });
    await onLeadCreated({ leadId, source: 'wizard' });
    const flow = await getFlowRow('wizard_lead_follow_up');
    const [run] = (await t.db.select().from(flowsRun).where(eq(flowsRun.flowId, flow.id))).filter((r) => r.context.leadId === leadId);
    expect(run!.nextStepAt!.getTime() - run!.startedAt.getTime()).toBe(48 * H);
    await runDue(new Date(run!.startedAt.getTime() + 48 * H));
    const msgs = await messagesOf(run!.id);
    expect(msgs.map((m) => m.templateKey)).toEqual(['lead.follow_up']);
    expect((msgs[0]!.rendered as { text: string }).text).toContain('https://shop.example.test/plan/results/p1');

    const phone2 = nextPhone();
    await consent(phone2);
    const lead2 = newId();
    f.leads.set(lead2, { phone: phone2, name: null, link: null });
    await onLeadCreated({ leadId: lead2, source: 'wizard' });
    const [run2] = (await t.db.select().from(flowsRun).where(eq(flowsRun.flowId, flow.id))).filter((r) => r.context.leadId === lead2);
    f.purchases.push({ phone: phone2, at: new Date(run2!.startedAt.getTime() + H) });
    await runDue(new Date(run2!.startedAt.getTime() + 48 * H));
    expect(await runOf(run2!.id)).toMatchObject({ status: 'stopped', stopReason: 'purchased', messages: 0 });
  });

  it('back in stock goes through the flow with product name and link; paused sends nothing', async () => {
    const phone = nextPhone();
    const productId = newId();
    const { messageIds } = await backInStockSender.send('stock.back_in_stock', { phone }, { productId, variantId: newId() });
    expect(messageIds.length).toBeGreaterThan(0);
    const [m] = await t.db.select().from(notificationsMessage).where(eq(notificationsMessage.id, messageIds[0]!));
    expect((m!.rendered as { text: string }).text).toContain(`Product ${productId.slice(0, 4)}`);
    expect((m!.rendered as { text: string }).text).toContain(`https://shop.example.test/p/${productId}`);
    expect(m!.flowRunId).toBeTruthy();

    await saveFlow('back_in_stock', { status: 'paused', settings: FLOW_DEFS.back_in_stock.defaults }, null);
    expect((await backInStockSender.send('stock.back_in_stock', { phone }, { productId, variantId: newId() })).messageIds).toEqual([]);
  });
});

describe('admin', () => {
  it('saving settings validates, bumps the version, audits, and keeps step rows in place', async () => {
    const before = await getFlowRow('abandoned_cart');
    const stepIds = (await t.db.select({ id: flowsStep.id }).from(flowsStep).where(eq(flowsStep.flowId, before.id)).orderBy(asc(flowsStep.position))).map((s) => s.id);
    const steps = FLOW_DEFS.abandoned_cart.defaults.steps.map((s, i) => (i === 1 ? { ...s, enabled: false } : s));
    const after = await saveFlow('abandoned_cart', { status: 'active', settings: { ...FLOW_DEFS.abandoned_cart.defaults, steps } }, STAFF.userId);
    expect(after.version).toBe(before.version + 1);
    const rows = await t.db.select().from(flowsStep).where(eq(flowsStep.flowId, before.id)).orderBy(asc(flowsStep.position));
    expect(rows.map((s) => s.id)).toEqual(stepIds);
    expect(rows.filter((r) => (r.config as { stage: number }).stage === 1).every((r) => !(r.config as { enabled: boolean }).enabled)).toBe(true);
    const audits = await t.db.select().from(coreAuditLog).where(and(eq(coreAuditLog.action, 'flow.update'), eq(coreAuditLog.actorId, STAFF.userId)));
    expect(audits.length).toBeGreaterThan(0);
    await expect(saveFlow('abandoned_cart', { status: 'active', settings: { ...FLOW_DEFS.abandoned_cart.defaults, maxPer7Days: -1 } }, null)).rejects.toThrow();
  });

  it('the settings form posts back into valid settings (hours to minutes, windows, empty rule)', async () => {
    const form = new FormData();
    form.set('key', 'abandoned_cart');
    form.set('enabled', 'on');
    ['cart.reminder_1', 'cart.reminder_2', 'cart.reminder_3'].forEach((tpl, i) => {
      if (i !== 1) form.set(`step${i}_enabled`, 'on');
      form.set(`step${i}_template`, tpl);
      form.set(`step${i}_channel`, 'whatsapp');
      form.set(`step${i}_delay_hours`, String([1.5, 24, 72][i]));
    });
    form.set('quietHours', '09:00-11:00, 18:30-21:00');
    form.set('maxPer7Days', '2');
    form.set('discountRuleId', '');
    form.set('codeValidHours', '24');
    const saved = await saveFlow('abandoned_cart', formToSettings(form, 'abandoned_cart'), null);
    expect(saved.status).toBe('active');
    expect(saved.settings.steps.map((st) => [st.enabled, st.delayMinutes, st.channel])).toEqual([
      [true, 90, 'whatsapp'],
      [false, 1440, 'whatsapp'],
      [true, 4320, 'whatsapp'],
    ]);
    expect(saved.settings).toMatchObject({ quietHours: ['09:00-11:00', '18:30-21:00'], maxPer7Days: 2, discountRuleId: null, codeValidHours: 24 });
  });

  it('pages need marketing.write / orders.read; test run sends every enabled step flagged as test', async () => {
    await expect(listFlowCards()).rejects.toThrow();
    await expect(testRun('abandoned_cart', { phone: nextPhone() }, null)).rejects.toThrow();
    signIn(STAFF);
    const phone = nextPhone();
    await consent(phone);
    await abandon({ phone }, ist('2026-10-20T12:00:00'));
    const cards = await listFlowCards();
    expect(cards.map((c) => c.flow.key)).toEqual(Object.keys(FLOW_DEFS));
    const { runId, messageIds } = await testRun('abandoned_cart', { phone: nextPhone(), email: 'staff@example.test' }, STAFF.userId);
    expect(messageIds).toHaveLength(6);
    const msgs = await messagesOf(runId);
    expect(msgs.every((m) => m.isTest)).toBe(true);
    const detail = await getFlowDetail('abandoned_cart');
    expect(detail.runs.find((r) => r.id === runId)).toMatchObject({ isTest: true, status: 'completed', messages: 6 });
    const abandoned = await listAbandonedCheckouts();
    expect(abandoned.rows.some((r) => r.run.id === runId)).toBe(false);
    expect(abandoned.rows.some((r) => r.valuePaise === 450_000)).toBe(true);
  });
});
