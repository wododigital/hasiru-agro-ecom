// The typed gateway client over real HTTP against the mock gateway (no database needed for these calls).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { phonepeMockState, resetPhonepeMock } from '../src/mocks/phonepe';
import { clearTokenCache, GatewayError, phonepeClient, phonepeProvider } from '../src/server/phonepe';
import { paymentsSettingsSchema } from '../src/settings';
import { startHarness, testEnv } from './harness';

let harness: Awaited<ReturnType<typeof startHarness>>;
const settings = paymentsSettingsSchema.parse({});
const noSleep = { sleep: async () => {} };
const pay = (id: string, amount = 25000) => ({
  merchantOrderId: id,
  amount,
  expireAfter: 900,
  metaInfo: { udf1: 'order' },
  paymentFlow: { type: 'PG_CHECKOUT', message: 'test', merchantUrls: { redirectUrl: `${harness.origin}/pay/return?a=x` } },
});

beforeAll(async () => {
  testEnv();
  harness = await startHarness();
});
afterAll(async () => harness?.close());
beforeEach(() => {
  resetPhonepeMock();
  clearTokenCache();
});

describe('token', () => {
  it('is cached until shortly before expires_at, then refreshed', async () => {
    phonepeMockState().tokenTtlSec = 60;
    let now = Date.now();
    const client = phonepeClient(settings, 'mock', { ...noSleep, now: () => now });
    await client.token();
    await client.token();
    expect(phonepeMockState().tokenCalls).toBe(1);
    now += 31_000; // past half of a 60 s lifetime
    await client.token();
    expect(phonepeMockState().tokenCalls).toBe(2);
  });

  it('single-flights concurrent refreshes', async () => {
    const client = phonepeClient(settings, 'mock', noSleep);
    await Promise.all(Array.from({ length: 8 }, () => client.token()));
    expect(phonepeMockState().tokenCalls).toBe(1);
  });

  it('re-authenticates once when the gateway says the token expired', async () => {
    const client = phonepeClient(settings, 'mock', noSleep);
    await client.token();
    phonepeMockState().tokens.clear(); // gateway forgot every token
    const res = await client.pay(pay('T-1-1'));
    expect(res.state).toBe('PENDING');
    expect(phonepeMockState().tokenCalls).toBe(2);
  });

  it('sandbox and live without credentials are not configured (no network call)', async () => {
    const r = await phonepeProvider(settings, 'live').testConnection!();
    expect(r).toMatchObject({ ok: false });
    expect(r.message).toMatch(/client ID/);
  });
});

describe('pay, status, refund', () => {
  it('pay returns a redirect to the mock pay page; status reads the order', async () => {
    const client = phonepeClient(settings, 'mock', noSleep);
    const res = await client.pay(pay('T-2-1'));
    expect(res.redirectUrl).toBe(`${harness.origin}/api/_mock/phonepe/paypage?o=T-2-1`);
    expect(res.expireAt).toBeGreaterThan(Date.now());
    expect((await client.status('T-2-1')).state).toBe('PENDING');
  });

  it('a reused merchantOrderId is BAD_REQUEST', async () => {
    const client = phonepeClient(settings, 'mock', noSleep);
    await client.pay(pay('T-3-1'));
    const err = await client.pay(pay('T-3-1')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect(err).toMatchObject({ status: 400, code: 'BAD_REQUEST' });
  });

  it('an unknown order is INVALID_MERCHANT_ORDER_ID', async () => {
    const err = await phonepeClient(settings, 'mock', noSleep).status('nope-1').catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 400, code: 'INVALID_MERCHANT_ORDER_ID' });
  });

  it('429: retried with back-off inside the call, then surfaced', async () => {
    const sleeps: number[] = [];
    const client = phonepeClient(settings, 'mock', { sleep: async (ms) => void sleeps.push(ms) });
    await client.pay(pay('T-4-1'));
    phonepeMockState().rateLimitNext = 2;
    expect((await client.status('T-4-1')).state).toBe('PENDING');
    expect(sleeps).toEqual([500, 1000]);
    phonepeMockState().rateLimitNext = 3;
    await expect(client.status('T-4-1')).rejects.toMatchObject({ status: 429 });
  });

  it('refund needs a completed order and cannot exceed the capture', async () => {
    const client = phonepeClient(settings, 'mock', noSleep);
    await client.pay(pay('T-5-1', 10000));
    await expect(client.refund({ merchantRefundId: 'T-5-1-R1', originalMerchantOrderId: 'T-5-1', amount: 5000 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    phonepeMockState().orders.get('T-5-1')!.state = 'COMPLETED';
    phonepeMockState().refundAutoComplete = false;
    expect((await client.refund({ merchantRefundId: 'T-5-1-R1', originalMerchantOrderId: 'T-5-1', amount: 6000 })).state).toBe('PENDING');
    await expect(client.refund({ merchantRefundId: 'T-5-1-R2', originalMerchantOrderId: 'T-5-1', amount: 5000 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect((await client.refundStatus('T-5-1-R1')).state).toBe('PENDING');
  });
});
