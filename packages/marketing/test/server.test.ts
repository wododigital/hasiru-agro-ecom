import { createHash } from 'node:crypto';
import { setSettings } from '@ecomkit/core/settings';
import { createTestDb, type TestDb } from '@ecomkit/core/testing';
import { hasConsent } from '@ecomkit/customers/server';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ConversionOrder } from '../src/domain/conversions';
import { capiDedupGroups, capiMockState, resetCapiMock } from '../src/mocks/meta-capi';
import { ga4MockState, resetGa4Mock } from '../src/mocks/ga4';
import { marketingConversionEvent, marketingTag } from '../src/schema';
import {
  configureMarketing,
  conversion,
  cspSources,
  postConsent,
  publicTagConfig,
  purchaseTagData,
  readAttribution,
  resetCspMemo,
  saveOrderAttribution,
  saveTag,
  settingsDef,
} from '../src/server';
import { customer, MANAGER, mockHttp, order, signInAs, SUPPORT, testEnv } from './helpers';

let t: TestDb;
const orders = new Map<string, ConversionOrder>();
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

beforeAll(async () => {
  testEnv();
  t = await createTestDb('wp-23-marketing', { schemas: ['core', 'customers', 'marketing'] });
  configureMarketing({ orders: { forConversion: async (id) => orders.get(id) ?? null }, http: mockHttp });
  await setSettings(
    settingsDef,
    { ga4MeasurementId: 'G-TEST1234', ga4ApiSecret: 'ga4-secret', ga4Mode: 'mock', metaPixelId: '123456789012', metaCapiToken: 'capi-token', metaMode: 'mock', adsConversionId: 'AW-123456789', adsPurchaseLabel: 'AbC_1' },
    { actorId: null, actorType: 'system' },
  );
});
afterAll(async () => {
  configureMarketing({ orders: null, http: null });
  await t?.close();
});
beforeEach(() => {
  resetGa4Mock();
  resetCapiMock();
});

/** An order with full consent captured at checkout. */
async function consentedOrder(over: Partial<ConversionOrder> = {}, consent = { analytics: true, marketing: true }) {
  const o = order(over);
  orders.set(o.orderId, o);
  const cookies = new Map([
    ['ek_consent', `a${consent.analytics ? 1 : 0}.m${consent.marketing ? 1 : 0}.1760000000`],
    ['_ga', 'GA1.1.111.222'],
    ['_fbp', 'fb.1.1760000000000.1234567890'],
    ['ek_click', encodeURIComponent(JSON.stringify({ fbclid: 'IwAR1abc', fbclidAt: 1_760_000_000_000 }))],
  ]);
  await saveOrderAttribution(o.orderId, readAttribution({ get: (n) => (cookies.has(n) ? { value: cookies.get(n)! } : undefined) }, 'Mozilla/5.0 Test'));
  return o;
}

describe('server conversions', () => {
  it('sends purchase to GA4 and Meta with a shared event id and hashed, normalised contact data', async () => {
    const o = await consentedOrder();
    const results = await conversion('purchase', o.orderId);
    expect(results.map((r) => [r.destination, r.status])).toEqual([
      ['ga4', 'sent'],
      ['meta', 'sent'],
    ]);
    const eventId = `purchase.${o.orderId}`;
    expect(results.every((r) => r.eventId === eventId)).toBe(true);

    const ga = ga4MockState().received;
    expect(ga).toHaveLength(1);
    expect(ga[0]!.body.client_id).toBe('111.222');
    expect(ga[0]!.body.events[0]!.params).toMatchObject({ transaction_id: o.orderNumber, value: 2499, currency: 'INR' });

    const [capi] = capiMockState().received;
    expect(capi!.pixelId).toBe('123456789012');
    expect(capi!.event.event_id).toBe(eventId);
    expect(capi!.event.user_data.em).toEqual([sha('buyer@example.com')]);
    expect(capi!.event.user_data.ph).toEqual([sha('919845012345')]);
    expect(capi!.event.user_data.zp).toEqual([sha('560001')]);
    expect(capi!.event.user_data.country).toEqual([sha('in')]);
    expect(capi!.event.user_data.fbp).toBe('fb.1.1760000000000.1234567890');
    expect(capi!.event.user_data.fbc).toBe('fb.1.1760000000000.IwAR1abc');
    expect(JSON.stringify(capi!.event.user_data)).not.toContain('buyer@example.com');

    // The browser pixel gets the same id, so Meta keeps one of the two.
    expect((await purchaseTagData(o.orderId))?.eventId).toBe(eventId);
  });

  it('dedupes retries and repeated events per destination', async () => {
    const o = await consentedOrder();
    await conversion('purchase', o.orderId);
    const again = await conversion('purchase', o.orderId);
    expect(again.map((r) => r.status)).toEqual(['duplicate', 'duplicate']);
    expect(ga4MockState().received).toHaveLength(1);
    expect([...capiDedupGroups().values()]).toEqual([1]);
    expect(await t.db.select().from(marketingConversionEvent).where(eq(marketingConversionEvent.orderId, o.orderId))).toHaveLength(2);
  });

  it('never sends test orders, and records why', async () => {
    const o = await consentedOrder({ isTest: true });
    const results = await conversion('purchase', o.orderId);
    expect(results.map((r) => r.status)).toEqual(['skipped_test', 'skipped_test']);
    expect(ga4MockState().received).toHaveLength(0);
    expect(capiMockState().received).toHaveLength(0);
    expect(await purchaseTagData(o.orderId)).toBeNull();
  });

  it('honours the consent captured at checkout per destination', async () => {
    const analyticsOnly = await consentedOrder({}, { analytics: true, marketing: false });
    expect((await conversion('purchase', analyticsOnly.orderId)).map((r) => r.status)).toEqual(['sent', 'skipped_consent']);
    const none = order();
    orders.set(none.orderId, none); // no attribution row at all: fail closed
    expect((await conversion('purchase', none.orderId)).map((r) => r.status)).toEqual(['skipped_consent', 'skipped_consent']);
  });

  it('retries only the destination that failed', async () => {
    const o = await consentedOrder();
    let failMeta = true;
    configureMarketing({
      http: async (url, init) => {
        if (failMeta && url.includes('meta-capi')) {
          failMeta = false;
          return new Response(JSON.stringify({ error: { message: 'temporarily unavailable', code: 2 } }), { status: 503 });
        }
        return mockHttp(url, init);
      },
    });
    await expect(conversion('purchase', o.orderId)).rejects.toThrow(/failed for meta/);
    const second = await conversion('purchase', o.orderId);
    expect(second.map((r) => [r.destination, r.status])).toEqual([
      ['ga4', 'duplicate'],
      ['meta', 'sent'],
    ]);
    expect(ga4MockState().received).toHaveLength(1);
    configureMarketing({ http: mockHttp });
  });

  it('sends refunds to GA4 only, keyed by the refund id', async () => {
    const o = await consentedOrder();
    const results = await conversion('refund', o.orderId, { refundId: 'rf-1', amountPaise: 50_000 });
    expect(results).toEqual([{ destination: 'ga4', eventId: 'refund.rf-1', status: 'sent' }]);
    expect(ga4MockState().received[0]!.body.events[0]).toMatchObject({ name: 'refund', params: { transaction_id: o.orderNumber, value: 500 } });
  });

  it('the CAPI mock rejects unhashed data the way Meta does', async () => {
    const res = await mockHttp('https://x/api/_mock/meta-capi/v26.0/123456789012/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ access_token: 't', data: [{ event_name: 'Purchase', event_time: Math.floor(Date.now() / 1000), action_source: 'website', event_source_url: 'https://shop.example/', user_data: { em: ['plain@example.com'], client_user_agent: 'UA' } }] }),
    });
    expect(res.status).toBe(400);
    expect(capiMockState().received).toHaveLength(0);
  });

  it('skips cleanly without an orders port', async () => {
    configureMarketing({ orders: null });
    expect(await conversion('purchase', order().orderId)).toEqual([]);
    configureMarketing({ orders: { forConversion: async (id) => orders.get(id) ?? null } });
  });
});

describe('POST /api/consent', () => {
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    postConsent(new Request('https://shop.example/api/consent', { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...headers }, body: JSON.stringify(body) }));

  it('refuses cross-site posts and bad bodies', async () => {
    signInAs({ kind: 'guest' });
    expect((await post({ analytics: true, marketing: true }, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await post({ analytics: 'yes' })).status).toBe(400);
    expect((await post({ analytics: true, marketing: true, extra: 1 })).status).toBe(400);
  });

  it('sets the cookie for a guest without writing consent rows', async () => {
    signInAs({ kind: 'guest' });
    const res = await post({ analytics: true, marketing: false });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/^ek_consent=a1\.m0\.\d+; Path=\/; Max-Age=31536000; SameSite=Lax; Secure$/);
  });

  it('records a signed-in customer in customers_consent, only for purposes that changed', async () => {
    const me = customer();
    signInAs(me);
    await post({ analytics: true, marketing: true });
    expect(await hasConsent({ userId: me.userId }, 'marketing')).toBe(true);
    expect(await hasConsent({ phone: me.phone }, 'analytics_identity')).toBe(true);
    await post({ analytics: true, marketing: false }, { cookie: 'ek_consent=a1.m1.1760000000' });
    expect(await hasConsent({ userId: me.userId }, 'marketing')).toBe(false);
    expect(await hasConsent({ userId: me.userId }, 'analytics_identity')).toBe(true);
    const { rows } = await t.pool.query(`select purpose, status, source from customers_consent where user_id = $1 order by created_at, id`, [me.userId]);
    expect(rows).toEqual([
      { purpose: 'analytics_identity', status: 'granted', source: 'banner' },
      { purpose: 'marketing', status: 'granted', source: 'banner' },
      { purpose: 'marketing', status: 'revoked', source: 'banner' },
    ]);
  });
});

describe('tags and CSP', () => {
  it('only marketing.write may change tags', async () => {
    signInAs(SUPPORT);
    await expect(saveTag({ name: 'X', snippet: '<i></i>' })).rejects.toThrow();
  });

  it('feeds the proxy CSP from configured vendors and active custom tags, never secrets to the browser', async () => {
    signInAs(MANAGER);
    await saveTag({ name: 'Chat widget', snippet: '<script src="https://widget.example.org/w.js"></script>', cspSources: 'https://widget.example.org', isActive: 'on' });
    await saveTag({ name: 'Old pixel', snippet: '<img src="https://old.example.org/p.gif">', cspSources: 'https://old.example.org' });
    resetCspMemo();
    const csp = await cspSources();
    expect(csp.script).toEqual(expect.arrayContaining(['https://widget.example.org', 'https://connect.facebook.net', 'https://www.googletagmanager.com', 'https://www.googleadservices.com']));
    expect(JSON.stringify(csp)).not.toContain('old.example.org');
    // memoised: a direct table write is not seen until the memo expires or a save resets it
    await t.db.update(marketingTag).set({ isActive: true });
    expect(JSON.stringify(await cspSources())).not.toContain('old.example.org');
    expect(JSON.stringify(await cspSources(Date.now() + 61_000))).toContain('old.example.org');

    const config = await publicTagConfig();
    expect(config).toMatchObject({ banner: true, ga4: 'G-TEST1234', metaPixel: '123456789012', ads: { id: 'AW-123456789', purchaseLabel: 'AbC_1', enhanced: false } });
    expect(config.custom.map((c) => c.snippet)).toHaveLength(2);
    expect(JSON.stringify(config)).not.toMatch(/ga4-secret|capi-token/);
  });
});
