import { randomUUID } from 'node:crypto';
import type { TestDb } from '@ecomkit/core/testing';
import { TEST_NOW } from '@ecomkit/core/testing';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyticsEvent, analyticsSession, analyticsVisitor, analyticsWebVital } from '../src/schema';
import { onConsentChanged } from '../src/server/consent';
import { createBeaconIngest } from '../src/server/http';
import { ingest } from '../src/server/ingest';
import { analyticsDb, BOT_UA, CHROME_UA, ev, minutes } from './helpers';

let t: TestDb;
const at = (ms: number) => new Date(TEST_NOW.getTime() + ms);
const guest = async () => ({ kind: 'guest' }) as const;

beforeAll(async () => {
  t = await analyticsDb('wp-12-ingest');
});
afterAll(async () => {
  await t?.close();
});

async function eventsOf(sessionId: string) {
  return t.db.select().from(analyticsEvent).where(eq(analyticsEvent.sessionId, sessionId)).orderBy(analyticsEvent.id);
}

describe('ingest', () => {
  it('is idempotent: the same batch twice (and concurrently) stores each event once', async () => {
    const batch = { e: [ev('page_view', '/'), ev('view_item', '/p/mango'), ev('add_to_cart', '/p/mango', { item_id: 'mango', qty: 2 })] };
    const first = await ingest(batch, { cookie: null, userAgent: CHROME_UA, now: at(0) });
    expect(first).toMatchObject({ ok: true, accepted: 3, duplicates: 0 });
    if (!first.ok) throw new Error('unreachable');
    const again = await ingest(batch, { cookie: first.cookie, userAgent: CHROME_UA, now: at(5_000) });
    expect(again).toMatchObject({ ok: true, accepted: 0, duplicates: 3, sessionId: first.sessionId });
    const racing = await Promise.all([1, 2, 3].map(() => ingest(batch, { cookie: first.cookie, userAgent: CHROME_UA, now: at(6_000) })));
    expect(racing.every((r) => r.ok && r.accepted === 0)).toBe(true);
    expect(await eventsOf(first.sessionId)).toHaveLength(3);
  });

  it('a new visitor racing the same batch from two tabs still stores it once', async () => {
    const cookie = 'AAAAAAAAAAAAAAAAAAAAAA';
    const batch = { e: [ev('page_view', '/race')] };
    const results = await Promise.all([1, 2].map(() => ingest(batch, { cookie, userAgent: CHROME_UA, now: at(0) })));
    expect(results.map((r) => (r.ok ? r.accepted : -1)).sort()).toEqual([0, 1]);
  });

  it('splits sessions after 30 idle minutes and keeps them within the window', async () => {
    const a = await ingest({ e: [ev('page_view', '/')] }, { cookie: null, userAgent: CHROME_UA, now: at(0) });
    if (!a.ok) throw new Error('rejected');
    const b = await ingest({ e: [ev('page_view', '/plants')] }, { cookie: a.cookie, userAgent: CHROME_UA, now: at(minutes(29)) });
    const c = await ingest({ e: [ev('page_view', '/plants')] }, { cookie: a.cookie, userAgent: CHROME_UA, now: at(minutes(29) + minutes(30) + 1000) });
    const d = await ingest({ e: [ev('page_view', '/?utm_source=meta&utm_campaign=diwali')] }, { cookie: a.cookie, userAgent: CHROME_UA, now: at(minutes(65)) });
    expect(b.ok && b.sessionId).toBe(a.sessionId);
    expect(c.ok && c.sessionId).not.toBe(a.sessionId);
    expect(d.ok && d.sessionId).not.toBe(c.ok && c.sessionId);
    const sessions = await t.db.select().from(analyticsSession).where(eq(analyticsSession.visitorId, a.visitorId));
    expect(sessions).toHaveLength(3);
    const campaign = sessions.find((s) => s.id === (d.ok && d.sessionId));
    expect(campaign).toMatchObject({ channel: 'campaign', utm: { source: 'meta', campaign: 'diwali' }, landingPath: '/' });
  });

  it('stores paths without query strings and props without personal data; mirrors web vitals', async () => {
    const r = await ingest(
      { e: [ev('search', '/search?q=9876543210', { q: 'mango 98765 43210', results: 0, phone: '9876543210' }), ev('web_vital', '/', { m: 'LCP', v: 2100 })], r: 'www.google.com' },
      { cookie: null, userAgent: CHROME_UA, now: at(0) },
    );
    if (!r.ok) throw new Error('rejected');
    const [search, vital] = await eventsOf(r.sessionId);
    expect(search).toMatchObject({ path: '/search', props: { q: 'mango [phone]', results: 0 } });
    expect(vital?.name).toBe('web_vital');
    const [session] = await t.db.select().from(analyticsSession).where(eq(analyticsSession.id, r.sessionId));
    expect(session).toMatchObject({ channel: 'search', referrerHost: 'www.google.com', device: 'mobile' });
    const vitals = await t.db.select().from(analyticsWebVital).where(eq(analyticsWebVital.path, '/'));
    expect(vitals.some((v) => v.metric === 'LCP' && Number(v.value) === 2100)).toBe(true);
  });

  it('flags bots and test sessions (staff, or a test order)', async () => {
    const bot = await ingest({ e: [ev('page_view', '/')] }, { cookie: null, userAgent: BOT_UA, now: at(0) });
    const staff = await ingest({ e: [ev('page_view', '/')] }, { cookie: null, userAgent: CHROME_UA, isStaff: true, now: at(0) });
    const shopper = await ingest({ e: [ev('page_view', '/')] }, { cookie: null, userAgent: CHROME_UA, now: at(0) });
    if (!bot.ok || !staff.ok || !shopper.ok) throw new Error('rejected');
    await ingest({ e: [ev('purchase', '/order/x', { value: 50000, test: true })] }, { cookie: shopper.cookie, userAgent: CHROME_UA, now: at(1000) });
    const rows = await t.db.select().from(analyticsSession).where(sql`${analyticsSession.id} in (${bot.sessionId}, ${staff.sessionId}, ${shopper.sessionId})`);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(bot.sessionId)).toMatchObject({ isBot: true, botName: 'Googlebot' });
    expect(byId.get(staff.sessionId)).toMatchObject({ isTest: true, isBot: false });
    expect(byId.get(shopper.sessionId)).toMatchObject({ isTest: true });
  });

  it('links a customer only with analytics_identity consent and unlinks on revocation', async () => {
    const customerId = randomUUID();
    const asked: string[] = [];
    const denied = await ingest({ e: [ev('page_view')] }, { cookie: null, userAgent: CHROME_UA, customerId, hasConsent: async (q) => (asked.push(q.purpose), false), now: at(0) });
    if (!denied.ok) throw new Error('rejected');
    expect(denied.linked).toBe(false);
    expect(asked).toEqual(['analytics_identity']);
    const noLookup = await ingest({ e: [ev('page_view')] }, { cookie: denied.cookie, userAgent: CHROME_UA, customerId, now: at(1000) });
    expect(noLookup.ok && noLookup.linked).toBe(false);

    const granted = await ingest({ e: [ev('page_view')] }, { cookie: denied.cookie, userAgent: CHROME_UA, customerId, hasConsent: async () => true, now: at(2000) });
    expect(granted.ok && granted.linked).toBe(true);
    const [v] = await t.db.select().from(analyticsVisitor).where(eq(analyticsVisitor.id, denied.visitorId));
    expect(v?.customerId).toBe(customerId);

    await onConsentChanged({ customerId, leadId: null, purpose: 'analytics_identity', granted: false }, { eventId: randomUUID(), emittedAt: new Date(), log: console });
    const [after] = await t.db.select().from(analyticsVisitor).where(eq(analyticsVisitor.id, denied.visitorId));
    expect(after?.customerId).toBeNull();
  });

  it('rejects a malformed envelope', async () => {
    expect(await ingest({ nope: 1 }, { cookie: null, userAgent: CHROME_UA })).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('POST /api/beacon-ingest', () => {
  const post = (body: string, headers: Record<string, string> = {}) =>
    new Request('https://shop.example/api/beacon-ingest', {
      method: 'POST',
      body,
      headers: { 'content-type': 'text/plain;charset=UTF-8', 'user-agent': CHROME_UA, 'x-real-ip': '203.0.113.9', ...headers },
    });
  const handler = createBeaconIngest({ getViewer: guest, ratePerMinute: 1000 });

  it('answers 204, sets an HttpOnly first-party visitor cookie, and reuses it', async () => {
    const res = await handler(post(JSON.stringify({ e: [ev('page_view', '/')] })));
    expect(res.status).toBe(204);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^ek_vid=[A-Za-z0-9_-]{22}; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Lax; Secure$/);
    const value = cookie.split(';')[0]!;
    const again = await handler(post(JSON.stringify({ e: [ev('page_view', '/plants')] }), { cookie: value }));
    expect(again.headers.get('set-cookie')!.split(';')[0]).toBe(value);
    const visitors = await t.db.execute(sql`select count(*)::int as n from analytics_visitor where cookie_hash is not null and last_seen > first_seen - interval '1 day'`);
    expect(Number(visitors.rows[0]!.n)).toBeGreaterThan(0);
  });

  it('refuses cross-site posts, oversize bodies and bad JSON', async () => {
    expect((await handler(post('{}', { 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
    expect((await handler(post('x'.repeat(20_000)))).status).toBe(413);
    expect((await handler(post('{not json'))).status).toBe(400);
    expect((await handler(post(JSON.stringify({ e: 'nope' })))).status).toBe(400);
  });

  it('rate-limits per IP under its own key', async () => {
    const tight = createBeaconIngest({ getViewer: guest, ratePerMinute: 2 });
    const body = () => JSON.stringify({ e: [ev('page_view', '/')] });
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await tight(post(body(), { 'x-real-ip': '198.51.100.77' }))).status);
    expect(statuses).toEqual([204, 204, 429]);
    const keys = await t.db.execute<{ key: string }>(sql`select key from core_rate_limit where key like 'beacon-ingest:%'`);
    expect(keys.rows.length).toBeGreaterThan(0);
    expect((await tight(post(body(), { 'x-real-ip': '198.51.100.78' }))).status).toBe(204);
  });

  it('marks staff sessions as test sessions', async () => {
    const staff = createBeaconIngest({
      getViewer: async () => ({ kind: 'staff', userId: randomUUID(), name: 'A', email: 'a@x.in', role: 'owner', permissions: [] }),
      ratePerMinute: 1000,
    });
    const res = await staff(post(JSON.stringify({ e: [ev('page_view', '/staff-visit')] }), { 'x-real-ip': '192.0.2.10' }));
    expect(res.status).toBe(204);
    const { rows } = await t.db.execute<{ is_test: boolean }>(sql`select is_test from analytics_session where landing_path = '/staff-visit'`);
    expect(rows[0]?.is_test).toBe(true);
  });
});
