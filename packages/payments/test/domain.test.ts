import { createHash } from 'node:crypto';
import type { Paise } from '@ecomkit/core/contracts';
import { describe, expect, it } from 'vitest';
import {
  advancePaise,
  backoffSec,
  decide,
  gatewayState,
  merchantOrderId,
  merchantRefundId,
  payRequest,
  payResponse,
  PHONEPE_HOSTS,
  pollDelaySec,
  refundable,
  webhookBody,
  webhookDedupeKey,
  type DecideInput,
} from '../src/domain';
import { webhookAuthorized } from '../src/server/phonepe';

describe('ids', () => {
  it('merchant order id is <number>-<attempt> and refuses what the gateway refuses', () => {
    expect(merchantOrderId('A-2610-00012', 2)).toBe('A-2610-00012-2');
    expect(() => merchantOrderId('A 1', 1)).toThrow(RangeError);
    expect(() => merchantOrderId('x'.repeat(62), 10)).toThrow(RangeError); // 65 chars > 63
    expect(() => merchantOrderId('A-1', 0)).toThrow(RangeError);
    expect(merchantRefundId('A-2610-00012-2', 1)).toBe('A-2610-00012-2-R1');
  });
});

describe('amounts', () => {
  it('advance is the share rounded up to whole rupees, at least Rs 1, never above the total', () => {
    expect(advancePaise(250000 as Paise, 30)).toBe(75000);
    expect(advancePaise(100050 as Paise, 30)).toBe(30100); // 300.15 -> 301
    expect(advancePaise(150 as Paise, 10)).toBe(100);
    expect(advancePaise(80 as Paise, 30)).toBe(80);
    expect(advancePaise(1000 as Paise, 10)).toBe(100);
  });
  it('refundable counts started and done refunds, not failed ones', () => {
    expect(refundable(10000, [{ amountPaise: 3000, state: 'completed' }, { amountPaise: 2000, state: 'failed' }, { amountPaise: 1000, state: 'task' }])).toBe(6000);
    expect(refundable(1000, [{ amountPaise: 1000, state: 'pending' }])).toBe(0);
  });
});

describe('gateway parsing', () => {
  it('maps states leniently', () => {
    expect(gatewayState('COMPLETED')).toBe('completed');
    expect(gatewayState('failed')).toBe('failed');
    expect(gatewayState('PENDING')).toBe('pending');
    expect(gatewayState(undefined)).toBe('pending');
  });
  it('reads expireAt or the documented expiryAt', () => {
    const base = { orderId: 'OMO1', state: 'PENDING', redirectUrl: 'https://pay.example/x' };
    expect(payResponse.parse({ ...base, expireAt: 5 }).expireAt).toBe(5);
    expect(payResponse.parse({ ...base, expiryAt: '7' }).expireAt).toBe(7);
    expect(payResponse.parse(base).expireAt).toBeNull();
  });
  it('clamps expireAfter to 300..3600 s', () => {
    const r = (s: number) => payRequest({ merchantOrderId: 'A-1', amountPaise: 100, expireAfterSec: s, redirectUrl: 'https://x.example', orderRef: 'o', message: 'm' }).expireAfter;
    expect([r(10), r(900), r(99999)]).toEqual([300, 900, 3600]);
  });
  it('live token host differs from the live API path', () => {
    expect(PHONEPE_HOSTS.live.token).toContain('/apis/identity-manager/');
    expect(PHONEPE_HOSTS.live.api).toBe('https://api.phonepe.com/apis/pg');
    expect(PHONEPE_HOSTS.sandbox.token).toBe('https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token');
  });
  it('webhook body keeps unknown keys and reads event + payload.state', () => {
    const b = webhookBody.parse({ event: 'checkout.order.completed', type: 'CHECKOUT_ORDER_COMPLETED', extra: 1, payload: { merchantOrderId: 'A-1', state: 'COMPLETED', more: true } });
    expect(b.event).toBe('checkout.order.completed');
    expect(b.payload.state).toBe('COMPLETED');
    expect(webhookDedupeKey('checkout.order.completed', 'A-1', 'COMPLETED')).toBe('checkout.order.completed:A-1:COMPLETED');
  });
});

describe('webhook authorization (SHA256 of username:password)', () => {
  const creds = { username: 'hook', password: 's3cret:pw' };
  const digest = createHash('sha256').update('hook:s3cret:pw').digest();
  it('accepts hex, upper-case hex, base64 and a SHA256 prefix', () => {
    expect(webhookAuthorized(digest.toString('hex'), creds)).toBe(true);
    expect(webhookAuthorized(digest.toString('hex').toUpperCase(), creds)).toBe(true);
    expect(webhookAuthorized(digest.toString('base64'), creds)).toBe(true);
    expect(webhookAuthorized(`SHA256 ${digest.toString('hex')}`, creds)).toBe(true);
  });
  it('refuses a wrong hash, a wrong length, an empty header and missing credentials', () => {
    expect(webhookAuthorized(createHash('sha256').update('hook:other').digest('hex'), creds)).toBe(false);
    expect(webhookAuthorized(digest.toString('hex').slice(0, 63), creds)).toBe(false);
    expect(webhookAuthorized(`${digest.toString('hex')}00`, creds)).toBe(false);
    expect(webhookAuthorized('', creds)).toBe(false);
    expect(webhookAuthorized(null, creds)).toBe(false);
    expect(webhookAuthorized(digest.toString('hex'), null)).toBe(false);
  });
});

describe('attempt state machine (decide)', () => {
  const base = (p: Partial<DecideInput> & { reported: DecideInput['reported'] }): DecideInput => ({
    attempt: { state: 'pending', amountPaise: 1000 },
    orderStatus: 'pending_payment',
    orderDuePaise: 1000,
    ...p,
  });
  it('pending -> completed applies to the order', () => {
    expect(decide(base({ reported: { state: 'completed', amountPaise: 1000 } }))).toEqual({ next: 'completed', apply: true, anomaly: null });
  });
  it('pending -> failed / expired, without touching the order', () => {
    expect(decide(base({ reported: { state: 'failed', amountPaise: null } }))).toEqual({ next: 'failed', apply: false, anomaly: null });
    expect(decide(base({ reported: { state: 'expired', amountPaise: null } }))).toEqual({ next: 'expired', apply: false, anomaly: null });
  });
  it('pending reports and replays are no-ops; completed is final', () => {
    const noop = { next: null, apply: false, anomaly: null };
    expect(decide(base({ reported: { state: 'pending', amountPaise: null } }))).toEqual(noop);
    expect(decide(base({ attempt: { state: 'completed', amountPaise: 1000 }, reported: { state: 'completed', amountPaise: 1000 } }))).toEqual(noop);
    expect(decide(base({ attempt: { state: 'completed', amountPaise: 1000 }, reported: { state: 'failed', amountPaise: null } }))).toEqual(noop);
    expect(decide(base({ attempt: { state: 'failed', amountPaise: 1000 }, reported: { state: 'expired', amountPaise: null } }))).toEqual(noop);
  });
  it('COMPLETED after FAILED or expiry is an anomaly, never applied', () => {
    for (const state of ['failed', 'expired'] as const) {
      expect(decide(base({ attempt: { state, amountPaise: 1000 }, reported: { state: 'completed', amountPaise: 1000 } }))).toEqual({ next: 'completed', apply: false, anomaly: 'late_completed' });
    }
  });
  it('COMPLETED on a cancelled (or already paid) order is an anomaly', () => {
    for (const orderStatus of ['cancelled', 'paid', 'missing']) {
      expect(decide(base({ orderStatus, reported: { state: 'completed', amountPaise: 1000 } })).anomaly).toBe('late_completed');
    }
  });
  it('amount mismatch (reported or above what the order owes) is an anomaly', () => {
    expect(decide(base({ reported: { state: 'completed', amountPaise: 999 } })).anomaly).toBe('amount_mismatch');
    expect(decide(base({ orderDuePaise: 500, reported: { state: 'completed', amountPaise: 1000 } })).anomaly).toBe('amount_mismatch');
  });
});

describe('cadence', () => {
  it('polls early then slower; 429 backs off 30 s doubling to 5 min', () => {
    expect([pollDelaySec(25), pollDelaySec(120), pollDelaySec(900)]).toEqual([20, 30, 60]);
    expect([1, 2, 3, 4, 5, 6].map(backoffSec)).toEqual([30, 60, 120, 240, 300, 300]);
  });
});
