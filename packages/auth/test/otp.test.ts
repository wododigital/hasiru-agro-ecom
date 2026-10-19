import type { OutboundMessage } from '@ecomkit/core/contracts';
import { queuedJobs, type TestDb } from '@ecomkit/core/testing';
import { eq, like, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authUser, authVerification } from '../src/schema';
import { hashCode, storePhoneCode } from '../src/server/codes';
import { sendOtp, verifyOtp } from '../src/server/otp';
import { resolveViewer } from '../src/server/viewer';
import { Jar, setupAuthDb, varOf } from './helpers';

let t: TestDb;
let sent: OutboundMessage[];
let ipSeq = 0;
const freshIp = () => `198.51.100.${++ipSeq}`;

beforeAll(async () => {
  ({ t, sent } = await setupAuthDb('wp-02-otp'));
});

afterAll(async () => {
  await t?.close();
});

async function sendAndRead(identifier: string, ip = freshIp()): Promise<string> {
  const before = sent.length;
  expect(await sendOtp({ identifier, ip })).toEqual({ status: 'sent' });
  expect(sent.length).toBe(before + 1);
  return varOf(sent.at(-1), 'code');
}

describe('phone code sign-in', () => {
  it('sends a 6-digit code through the notification channel and stores only its keyed hash', async () => {
    const code = await sendAndRead('98765 00001');
    expect(code).toMatch(/^\d{6}$/);
    const msg = sent.at(-1)!;
    expect(msg.templateKey).toBe('otp.login');
    expect(msg.to).toBe('+919876500001');
    const [row] = await t.db.select().from(authVerification).where(eq(authVerification.identifier, 'phone-otp:+919876500001'));
    expect(row!.value).toBe(`${hashCode(code)}:0`);
    expect(row!.value).not.toContain(code);
    expect(row!.expiresAt.getTime() - Date.now()).toBeGreaterThan(290_000);
  });

  it('verifies, creates the customer on first use and signs them in', async () => {
    const code = await sendAndRead('+91 98765 00002');
    const jar = new Jar(freshIp());
    const result = await verifyOtp({ identifier: '9876500002', code, requestHeaders: jar.headers() });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    jar.apply(result.headers);
    const viewer = await resolveViewer(jar.headers());
    expect(viewer).toMatchObject({ kind: 'customer', userId: result.userId, customerId: result.userId, phone: '+919876500002', email: null, name: null });
    const [user] = await t.db.select().from(authUser).where(eq(authUser.id, result.userId));
    expect(user).toMatchObject({ role: 'customer', phoneNumberVerified: true, email: '919876500002@phone.invalid' });
    // A used code is gone.
    expect(await verifyOtp({ identifier: '9876500002', code, requestHeaders: new Jar(freshIp()).headers() })).toEqual({ status: 'invalid' });
  });

  it('emits customer.created once for a new customer', async () => {
    const code = await sendAndRead('9876500003');
    const result = await verifyOtp({ identifier: '9876500003', code, requestHeaders: new Jar(freshIp()).headers() });
    if (result.status !== 'ok') throw new Error('sign-in failed');
    const events = (await queuedJobs(t.db, 'core.event')).filter(
      (j) => (j.data as { event: string; payload: { customerId: string } }).payload.customerId === result.userId,
    );
    expect(events.map((j) => (j.data as { event: string }).event)).toEqual(['customer.created']);
  });

  it('gives one generic answer for wrong, expired, burnt and never-issued codes', async () => {
    const h = () => new Jar(freshIp()).headers();
    const neverIssued = await verifyOtp({ identifier: '9876500010', code: '123456', requestHeaders: h() });

    const code = await sendAndRead('9876500011');
    const wrong = await verifyOtp({ identifier: '9876500011', code: code === '000000' ? '111111' : '000000', requestHeaders: h() });

    const expiredCode = await sendAndRead('9876500012');
    await t.db.update(authVerification).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(authVerification.identifier, 'phone-otp:+919876500012'));
    const expired = await verifyOtp({ identifier: '9876500012', code: expiredCode, requestHeaders: h() });

    const malformed = await verifyOtp({ identifier: '9876500011', code: '12ab', requestHeaders: h() });
    for (const r of [neverIssued, wrong, expired, malformed]) expect(r).toEqual({ status: 'invalid' });
  });

  it('burns a code after 3 wrong attempts, so the right code no longer works', async () => {
    const code = await sendAndRead('9876500020');
    const wrong = code === '999999' ? '000000' : '999999';
    for (let i = 0; i < 3; i++) expect((await verifyOtp({ identifier: '9876500020', code: wrong, requestHeaders: new Jar(freshIp()).headers() })).status).toBe('invalid');
    expect(await verifyOtp({ identifier: '9876500020', code, requestHeaders: new Jar(freshIp()).headers() })).toEqual({ status: 'invalid' });
    expect(await t.db.select().from(authVerification).where(eq(authVerification.identifier, 'phone-otp:+919876500020'))).toHaveLength(0);
  });

  it('a new code replaces the previous one', async () => {
    const first = await sendAndRead('9876500021');
    const second = await sendAndRead('9876500021');
    if (first !== second) expect((await verifyOtp({ identifier: '9876500021', code: first, requestHeaders: new Jar().headers() })).status).toBe('invalid');
    expect((await verifyOtp({ identifier: '9876500021', code: second, requestHeaders: new Jar().headers() })).status).toBe('ok');
  });
});

describe('limits', () => {
  it('sends at most 3 codes per number per 10 minutes', async () => {
    for (let i = 0; i < 3; i++) await sendAndRead('9876500030');
    const fourth = await sendOtp({ identifier: '9876500030', ip: freshIp() });
    expect(fourth.status).toBe('rate_limited');
    if (fourth.status === 'rate_limited') expect(fourth.retryAfterSec).toBeGreaterThan(500);
    const later = await sendOtp({ identifier: '9876500030', ip: freshIp(), now: new Date(Date.now() + 601_000) });
    expect(later).toEqual({ status: 'sent' });
  });

  it('sends at most 10 codes per IP per hour, across numbers', async () => {
    const ip = freshIp();
    for (let i = 0; i < 10; i++) await sendAndRead(`98765001${String(i).padStart(2, '0')}`, ip);
    expect((await sendOtp({ identifier: '9876500199', ip })).status).toBe('rate_limited');
    expect((await sendOtp({ identifier: '9876500199', ip: freshIp() })).status).toBe('sent');
  });

  it('checks at most 5 codes per identifier per 10 minutes', async () => {
    const results = [];
    for (let i = 0; i < 6; i++) results.push((await verifyOtp({ identifier: '9876500040', code: '123456', requestHeaders: new Jar(freshIp()).headers() })).status);
    expect(results).toEqual(['invalid', 'invalid', 'invalid', 'invalid', 'invalid', 'rate_limited']);
  });

  it('rejects malformed identifiers without spending a send', async () => {
    for (const bad of ['12345', '+1 415 555 0100', 'not-an-email@', '']) expect(await sendOtp({ identifier: bad, ip: freshIp() })).toEqual({ status: 'invalid' });
  });
});

describe('email code sign-in', () => {
  it('sends, stores hashed, verifies and signs in by email', async () => {
    const code = await sendAndRead('  Buyer@Example.com ');
    expect(sent.at(-1)!.to).toBe('buyer@example.com');
    const rows = await t.db.select().from(authVerification).where(like(authVerification.identifier, '%buyer@example.com%'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).not.toContain(code);
    const jar = new Jar(freshIp());
    const result = await verifyOtp({ identifier: 'buyer@example.com', code, requestHeaders: jar.headers() });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') jar.apply(result.headers);
    expect(await resolveViewer(jar.headers())).toMatchObject({ kind: 'customer', email: 'buyer@example.com', phone: null });
  });
});

describe('staff never sign in with a code', () => {
  beforeAll(async () => {
    await t.db.insert(authUser).values([
      { email: 'manager@example.com', name: 'M', role: 'manager', twoFactorEnabled: true },
      { email: 'fulfil@example.com', name: 'F', role: 'fulfilment', phoneNumber: '+919876509999', phoneNumberVerified: true },
    ]);
  });

  it('answers "sent" to a staff email but sends nothing', async () => {
    const before = sent.length;
    expect(await sendOtp({ identifier: 'manager@example.com', ip: freshIp() })).toEqual({ status: 'sent' });
    expect(await sendOtp({ identifier: '9876509999', ip: freshIp() })).toEqual({ status: 'sent' });
    expect(sent.length).toBe(before);
  });

  it('refuses a staff session from a phone code even when the code is right', async () => {
    await storePhoneCode('+919876509999', '424242');
    const result = await verifyOtp({ identifier: '9876509999', code: '424242', requestHeaders: new Jar(freshIp()).headers() });
    expect(result).toEqual({ status: 'invalid' });
    const [{ n }] = (await t.db.execute<{ n: number }>(sql`select count(*)::int as n from auth_session s join auth_user u on u.id = s.user_id where u.role <> 'customer'`)).rows as [{ n: number }];
    expect(n).toBe(0);
  });
});
