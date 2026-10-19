// Real Postgres + real HTTP: adapters run in mock mode against the mock route handlers served by a local
// HTTP server, and the mocks post signed webhooks back to the real webhook handler.
import { TEMPLATE_KEYS } from '@ecomkit/core/contracts';
import { signHmacSha256 } from '@ecomkit/core/http';
import { withTx } from '@ecomkit/core/db';
import { coreAuditLog } from '@ecomkit/core/schema';
import { createTestDb, queuedJobs, type TestDb } from '@ecomkit/core/testing';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEMPLATE_CHANNELS } from '../src/domain';
import { gmailMockState, resetGmailMock } from '../src/mocks/gmail';
import { flushMetaMock, metaMockState, resetMetaMock } from '../src/mocks/meta';
import { emailHealth, otpHealth, testEmailAction, whatsappHealth } from '../src/server/actions';
import { clearGmailTokenCache } from '../src/server/channels';
import { loadSettings, updateSettings } from '../src/server/config';
import { connectGmailAction, signState } from '../src/server/gmail-oauth';
import { deliver, queueMessages, send, sendSessionText, type DeliverJobData } from '../src/server/sender';
import { renderTemplate, saveTemplate, TemplateVariableError } from '../src/server/templates';
import { processWebhookEvents, submitWhatsappTemplates, syncWhatsappTemplates } from '../src/server/whatsapp';
import { notificationsMessage, notificationsOptout, notificationsWebhookEvent, notificationsWhatsappTemplate } from '../src/schema';
import { createQueues, signIn, STAFF, startHarness, testEnv } from './harness';

let t: TestDb;
let harness: Awaited<ReturnType<typeof startHarness>>;
const PHONE = '+919876543210';
const NOW = new Date('2026-10-20T10:00:00+05:30');
const noSleep = { sleep: async () => {} };

const rowOf = async (id: string) => (await t.db.select().from(notificationsMessage).where(eq(notificationsMessage.id, id)))[0]!;
const orderVars = { name: 'Asha', order_number: 'A-2610-00001', total: 'Rs 1,250', order_link: 'https://shop.example/order/x' };

/** Queue then deliver at once (what the worker does). */
async function sendNow(...args: Parameters<typeof queueMessages>) {
  const { messageIds, queued } = await queueMessages(...args);
  const results = [];
  for (const job of queued) results.push(await deliver(job, { attempt: 1 }, noSleep));
  return { messageIds, queued, results };
}

async function settle(): Promise<void> {
  await flushMetaMock();
  await processWebhookEvents();
}

beforeAll(async () => {
  testEnv();
  harness = await startHarness();
  t = await createTestDb('wp-10-server', { schemas: ['core', 'notifications'] });
  await createQueues();
  await updateSettings({ storeName: 'Acme Store', adminEmail: 'admin@example.test', adminPhone: '+919800000001' }, { actorId: null });
  metaMockState().statusDelayMs = 0;
}, 90_000);

afterAll(async () => {
  await harness?.close();
  await t?.close();
});

beforeEach(() => {
  resetMetaMock();
  metaMockState().statusDelayMs = 0;
  metaMockState().approveAfterMs = 0;
  resetGmailMock();
  clearGmailTokenCache();
  signIn(null);
});

describe('template registry', () => {
  it('every frozen key renders on every channel (email, whatsapp, sms)', async () => {
    for (const key of TEMPLATE_KEYS) {
      for (const channel of TEMPLATE_CHANNELS) {
        const vars = new Proxy({}, { get: (_, k) => (k === 'store_name' ? 'Acme Store' : `x-${String(k)}`) }) as Record<string, string>;
        const r = await renderTemplate(key, channel, vars);
        expect(r.text, `${key}/${channel}`).toContain('Acme Store');
        expect(r.text).not.toMatch(/\{\{/);
      }
    }
  });

  it('admin overrides: versioned, audited, used by sends; unknown variables refused', async () => {
    await expect(saveTemplate({ key: 'order.packed', channel: 'sms', body: 'Hi {{name}}, {{coupon}}' }, STAFF.userId)).rejects.toThrow(TemplateVariableError);
    const v1 = await saveTemplate({ key: 'order.packed', channel: 'sms', body: 'Packed: {{order_number}} for {{name}} at {{store_name}}' }, STAFF.userId);
    const v2 = await saveTemplate({ key: 'order.packed', channel: 'sms', body: 'Packed now: {{order_number}} ({{store_name}})' }, STAFF.userId);
    expect([v1.version, v2.version]).toEqual([1, 2]);
    const r = await renderTemplate('order.packed', 'sms', { name: 'Asha', order_number: 'A-1', store_name: 'Acme Store' });
    expect(r.text).toBe('Packed now: A-1 (Acme Store)');
    expect((await renderTemplate('order.packed', 'email', { name: 'Asha', order_number: 'A-1', store_name: 'S' })).template.version).toBe(0);
    const audits = await t.db.select().from(coreAuditLog).where(eq(coreAuditLog.action, 'notifications.template.update'));
    expect(audits).toHaveLength(2);
  });
});

describe('send and deliver', () => {
  it('queues one row and one job per reachable channel, delivers email via Gmail and WhatsApp via /messages', async () => {
    const before = (await queuedJobs(t.db, 'notifications.deliver')).length;
    const { messageIds, results } = await sendNow('order.confirmed', { email: 'asha@example.com', phone: PHONE }, orderVars, { now: NOW });
    expect(messageIds).toHaveLength(2);
    expect((await queuedJobs(t.db, 'notifications.deliver')).length - before).toBe(2);
    expect(results.map((r) => r?.status)).toEqual(['sent', 'sent']);

    const mail = gmailMockState().outbox[0]!;
    expect(mail.headers.to).toBe('asha@example.com');
    expect(mail.headers.subject).toBe('Order A-2610-00001 confirmed');
    expect(mail.headers.from).toBe('Acme Store <outbox@example.test>');
    expect(mail.text).toContain('Order total: Rs 1,250.');

    const wa = metaMockState().sent[0]!;
    expect(wa.endpoint).toBe('messages');
    expect(wa.body.template).toMatchObject({ name: 'order_confirmed', language: { code: 'en' } });
    const params = (wa.body.template as { components: { parameters: { parameter_name: string; text: string }[] }[] }).components[0]!.parameters;
    expect(Object.fromEntries(params.map((p) => [p.parameter_name, p.text]))).toEqual({ ...orderVars, store_name: 'Acme Store' });

    const [email, whatsapp] = await Promise.all(messageIds.map(rowOf));
    expect(email!.status).toBe('sent');
    expect(email!.toMasked).toBe('a•••@example.com');
    expect(JSON.stringify(email!.rendered)).not.toContain('asha@example.com');
    expect(whatsapp!.providerMessageId).toMatch(/^wamid\.mock\./);

    // Delivery is idempotent: a duplicate job run does nothing.
    expect(await deliver({ messageId: messageIds[0]!, message: {} as DeliverJobData['message'] })).toBeNull();
  });

  it('status webhooks move the row forward (sent, delivered, read) with pricing; duplicates are dropped', async () => {
    const { messageIds } = await sendNow('order.packed', { phone: PHONE }, { name: 'Asha', order_number: 'A-2' }, { now: NOW });
    await settle();
    const row = await rowOf(messageIds[0]!);
    expect(row.status).toBe('read');
    expect(row.pricing).toMatchObject({ pricing_model: 'PMP', category: 'utility' });
    const events = await t.db.select().from(notificationsWebhookEvent).where(sql`${notificationsWebhookEvent.dedupeKey} like ${`wa:${row.providerMessageId}:%`}`);
    expect(events.map((e) => e.dedupeKey.split(':').at(-1)).sort()).toEqual(['delivered', 'read', 'sent']);

    // Meta retries: the same delivery again stores nothing new.
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: row.providerMessageId, status: 'delivered', timestamp: '1' }] } }] }] });
    const res = await fetch(`${harness.origin}/api/webhooks/whatsapp`, { method: 'POST', headers: { 'x-hub-signature-256': `sha256=${signHmacSha256(body, 'mock-app-secret')}` }, body });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: 0 });
  });

  it('webhook signature and verify token are enforced', async () => {
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    expect((await fetch(`${harness.origin}/api/webhooks/whatsapp`, { method: 'POST', headers: { 'x-hub-signature-256': `sha256=${signHmacSha256(body, 'wrong')}` }, body })).status).toBe(401);
    expect((await fetch(`${harness.origin}/api/webhooks/whatsapp`, { method: 'POST', body })).status).toBe(401);
    expect((await fetch(`${harness.origin}/api/webhooks/whatsapp`, { method: 'POST', headers: { 'x-hub-signature-256': `sha256=${signHmacSha256(body, 'mock-app-secret')}` }, body })).status).toBe(200);
    const ok = await fetch(`${harness.origin}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=mock-verify-token&hub.challenge=4242`);
    expect([ok.status, await ok.text()]).toEqual([200, '4242']);
    expect((await fetch(`${harness.origin}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1`)).status).toBe(403);
  });

  it('routes marketing templates to /marketing_messages (or /messages when the MM API is off)', async () => {
    await sendNow('cart.reminder_1', { phone: '+919800000101' }, { name: 'Ravi', cart_link: 'https://shop.example/r/abc' }, { now: NOW });
    expect(metaMockState().sent.at(-1)!.endpoint).toBe('marketing_messages');
    await updateSettings({ whatsappMarketingViaMmApi: false }, { actorId: null });
    await sendNow('cart.reminder_2', { phone: '+919800000101' }, { name: 'Ravi', cart_link: 'https://shop.example/r/abc' }, { now: NOW });
    expect(metaMockState().sent.at(-1)!.endpoint).toBe('messages');
    await updateSettings({ whatsappMarketingViaMmApi: true }, { actorId: null });
  });

  it('131049: marked failed by webhook, and marketing to that number pauses 24 h while utility still goes', async () => {
    const phone = '+919800000202';
    metaMockState().failNext = 131049;
    const { messageIds } = await sendNow('review.request', { phone }, { name: 'Meena', order_number: 'A-3', review_link: 'https://shop.example/review' }, { now: NOW });
    await settle();
    const failed = await rowOf(messageIds[0]!);
    expect([failed.status, failed.errorCode]).toEqual(['failed', '131049']);
    const later = await send('cart.reminder_1', { phone }, { name: 'Meena', cart_link: 'https://x.example' });
    expect((await rowOf(later.messageIds[0]!)).error).toBe('per_user_limit_24h');
    const utility = await send('order.packed', { phone }, { name: 'Meena', order_number: 'A-3' });
    expect((await rowOf(utility.messageIds[0]!)).status).toBe('queued');
  });

  it('130429: retried by the queue, failed after the last attempt', async () => {
    metaMockState().failNext = 130429;
    const { queued } = await queueMessages('order.dispatched', { phone: PHONE }, { name: 'Asha', order_number: 'A-4', delivery_date: '22 Oct' }, { now: NOW });
    await expect(deliver(queued[0]!, { attempt: 1 })).rejects.toThrow(/retrying/);
    expect(await rowOf(queued[0]!.messageId)).toMatchObject({ status: 'queued', errorCode: '130429' });
    metaMockState().failNext = 130429;
    const last = await deliver(queued[0]!, { attempt: 6 });
    expect(last?.status).toBe('failed');
    expect((await rowOf(queued[0]!.messageId)).status).toBe('failed');
  });

  it('STOP opts a number out of marketing (utility still sent); START opts back in; service window for free text', async () => {
    const phone = '+919800000303';
    await fetch(`${harness.origin}/api/_mock/meta/_inbound`, { method: 'POST', body: JSON.stringify({ from: phone, text: 'STOP' }) });
    await settle();
    expect(await t.db.select().from(notificationsOptout)).toHaveLength(1);
    const promo = await send('stock.back_in_stock', { phone }, { product_name: 'Mango', product_link: 'https://x.example/p' });
    expect((await rowOf(promo.messageIds[0]!)).error).toBe('opted_out');
    const update = await send('order.packed', { phone }, { name: 'Lata', order_number: 'A-5' });
    expect((await rowOf(update.messageIds[0]!)).status).toBe('queued');

    expect((await sendSessionText(phone, 'Thanks, noted.')).status).toBe('sent');
    expect(await sendSessionText('+919800000999', 'Hello')).toMatchObject({ status: 'skipped', error: 'outside_service_window' });

    await fetch(`${harness.origin}/api/_mock/meta/_inbound`, { method: 'POST', body: JSON.stringify({ from: phone, text: 'start' }) });
    await settle();
    expect(await t.db.select().from(notificationsOptout)).toHaveLength(0);
  });

  it('quiet hours: marketing queued at 22:30 IST starts at 09:00 IST; order updates go at once', async () => {
    const late = new Date('2026-10-20T22:30:00+05:30');
    const promo = await send('lead.follow_up', { phone: '+919800000404' }, { name: 'Kiran', link: 'https://x.example' }, { now: late });
    const upd = await send('order.packed', { phone: '+919800000404' }, { name: 'Kiran', order_number: 'A-6' }, { now: late });
    const startAfter = async (id: string) =>
      (await t.db.execute<{ s: Date }>(sql`select start_after as s from pgboss.job where name = 'notifications.deliver' and data->>'messageId' = ${id}`)).rows[0]!.s;
    expect(new Date(await startAfter(promo.messageIds[0]!)).toISOString()).toBe(new Date('2026-10-21T09:00:00+05:30').toISOString());
    expect(new Date(await startAfter(upd.messageIds[0]!)).getTime()).toBeLessThan(Date.now() + 5000);
  });

  it('OTP kill switch skips codes and raises the health warning', async () => {
    await updateSettings({ otpKillSwitch: true }, { actorId: null });
    const r = await send('otp.login', { phone: PHONE }, { code: '123456' });
    expect(await rowOf(r.messageIds[0]!)).toMatchObject({ status: 'skipped', error: 'otp_disabled' });
    expect((await otpHealth()).status).toBe('degraded');
    await updateSettings({ otpKillSwitch: false }, { actorId: null });
    expect((await otpHealth()).status).toBe('ok');
    const ok = await sendNow('otp.login', { phone: PHONE }, { code: '654321' }, { now: NOW });
    const body = metaMockState().sent.at(-1)!.body.template as { name: string; components: unknown[] };
    expect(body.name).toBe('otp_login');
    expect(body.components).toHaveLength(2);
    expect(ok.results[0]?.status).toBe('sent');
  });

  it('a send inside a rolled-back transaction leaves no row and no job', async () => {
    const jobsBefore = (await queuedJobs(t.db, 'notifications.deliver')).length;
    const rowsBefore = (await t.db.select().from(notificationsMessage)).length;
    await expect(
      withTx(async (tx) => {
        await send('order.packed', { phone: PHONE }, { name: 'A', order_number: 'A-7' }, { tx });
        throw new Error('order failed');
      }),
    ).rejects.toThrow('order failed');
    expect((await queuedJobs(t.db, 'notifications.deliver')).length).toBe(jobsBefore);
    expect((await t.db.select().from(notificationsMessage)).length).toBe(rowsBefore);
  });

  it('admin keys fall back to the admin address; channels that are off fall back to the log channel', async () => {
    const r = await send('enquiry.received_admin', {}, { enquiry_type: 'farm', name: 'Raj', phone: '+91 98000 00000', admin_link: 'https://x.example/admin' });
    const rows = await Promise.all(r.messageIds.map(rowOf));
    expect(rows.map((x) => x.channel).sort()).toEqual(['email', 'whatsapp']);
    await updateSettings({ emailMode: 'off', whatsappMode: 'off' }, { actorId: null });
    const logged = await sendNow('order.packed', { email: 'z@example.com', phone: PHONE }, { name: 'Z', order_number: 'A-8' }, { now: NOW });
    expect((await rowOf(logged.messageIds[0]!)).channel).toBe('log');
    expect(logged.results[0]?.status).toBe('sent');
    expect((await emailHealth()).status).toBe('not_configured');
    await updateSettings({ emailMode: 'mock', whatsappMode: 'mock' }, { actorId: null });
    expect((await whatsappHealth()).status).toBe('ok');
  });
});

describe('Gmail adapter', () => {
  it('refreshes the access token once on 401 and retries', async () => {
    await sendNow('order.packed', { email: 'a@example.com' }, { name: 'A', order_number: 'A-9' }, { now: NOW });
    const requests = gmailMockState().tokenRequests;
    gmailMockState().fail = { status: 401, times: 1 };
    const { results } = await sendNow('order.packed', { email: 'a@example.com' }, { name: 'A', order_number: 'A-10' }, { now: NOW });
    expect(results[0]?.status).toBe('sent');
    expect(gmailMockState().tokenRequests).toBe(requests + 1);
  });

  it('backs off on 429 and succeeds; gives up with a retriable failure after 5 tries', async () => {
    const slept: number[] = [];
    gmailMockState().fail = { status: 429, times: 2 };
    const { queued } = await queueMessages('order.packed', { email: 'a@example.com' }, { name: 'A', order_number: 'A-11' }, { now: NOW });
    expect((await deliver(queued[0]!, { attempt: 1 }, { sleep: async (ms) => void slept.push(ms) }))?.status).toBe('sent');
    expect(slept).toHaveLength(2);
    expect(slept[1]!).toBeGreaterThanOrEqual(2000);

    gmailMockState().fail = { status: 429, times: 10 };
    const again = await queueMessages('order.packed', { email: 'a@example.com' }, { name: 'A', order_number: 'A-12' }, { now: NOW });
    await expect(deliver(again.queued[0]!, { attempt: 1 }, noSleep)).rejects.toThrow(/retrying/);
  });

  it('a revoked refresh token fails permanently as gmail_refresh_failed', async () => {
    gmailMockState().revoked.add('mock-refresh');
    const { messageIds, results } = await sendNow('order.packed', { email: 'a@example.com' }, { name: 'A', order_number: 'A-13' }, { now: NOW });
    expect(results[0]).toMatchObject({ status: 'failed', errorCode: 'gmail_refresh_failed' });
    expect((await rowOf(messageIds[0]!)).status).toBe('failed');
  });

  it('Connect Gmail: signed state, consent, callback stores the refresh token for the same admin only', async () => {
    const action = await connectGmailAction({ actorId: STAFF.userId });
    expect(action.ok).toBe(true);
    const consent = new URL(action.redirectUrl!);
    expect(consent.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/gmail.send openid email');
    expect(consent.searchParams.get('access_type')).toBe('offline');
    const toCallback = await fetch(consent, { redirect: 'manual' });
    const callbackUrl = toCallback.headers.get('location')!;
    expect(callbackUrl).toContain('/api/auth/gmail/callback?code=mock-code-');

    // Nobody signed in, then a different admin: refused.
    expect((await fetch(callbackUrl, { redirect: 'manual' })).status).toBe(403);
    signIn({ ...STAFF, userId: '0192a000-0000-7000-8000-000000000002' });
    expect((await fetch(callbackUrl, { redirect: 'manual' })).status).toBe(403);
    // Tampered state.
    signIn(STAFF);
    const forged = new URL(callbackUrl);
    forged.searchParams.set('state', `${signState(STAFF.userId).split('.')[0]}.deadbeef`);
    expect((await fetch(forged, { redirect: 'manual' })).status).toBe(400);

    const done = await fetch(callbackUrl, { redirect: 'manual' });
    expect(done.status).toBe(303);
    expect(done.headers.get('location')).toMatch(/\/admin\/settings\/notifications\?gmail=connected$/);
    const s = await loadSettings();
    expect(s.gmailAccount).toBe('shop@example.test');
    expect(s.gmailRefreshToken).toMatch(/^mock-refresh-/);

    // The new token is what sends now.
    const { results } = await sendNow('order.packed', { email: 'a@example.com' }, { name: 'A', order_number: 'A-14' }, { now: NOW });
    expect(results[0]?.status).toBe('sent');
    expect(gmailMockState().outbox[0]!.headers.from).toBe('Acme Store <shop@example.test>');
    await updateSettings({ gmailRefreshToken: null, gmailAccount: '' }, { actorId: null });
  });

  it('Send test email action delivers test.send to the admin address', async () => {
    const r = await testEmailAction();
    expect(r).toMatchObject({ ok: true });
    expect(gmailMockState().outbox[0]!.headers).toMatchObject({ to: 'admin@example.test', subject: 'Test message from Acme Store' });
  });
});

describe('WhatsApp templates', () => {
  it('submits every template, syncs them back, and applies the approval webhook', async () => {
    const submitted = await submitWhatsappTemplates();
    expect(submitted.ok).toBe(true);
    expect(submitted.submitted).toHaveLength(TEMPLATE_KEYS.length);
    const sent = [...metaMockState().templates.values()];
    expect(sent.find((x) => x.name === 'order_packed')).toMatchObject({ category: 'UTILITY' });
    expect(sent.find((x) => x.name === 'cart_reminder_1')).toMatchObject({ category: 'MARKETING' });
    expect(sent.find((x) => x.name === 'otp_login')).toMatchObject({ category: 'AUTHENTICATION' });
    // Submitting again skips what is already pending or approved.
    expect((await submitWhatsappTemplates()).submitted).toHaveLength(0);

    await settle();
    const rows = await t.db.select().from(notificationsWhatsappTemplate);
    expect(rows).toHaveLength(TEMPLATE_KEYS.length);
    expect(rows.every((r) => r.status === 'approved')).toBe(true);

    const synced = await syncWhatsappTemplates();
    expect(synced).toMatchObject({ ok: true, count: TEMPLATE_KEYS.length });
  });
});
