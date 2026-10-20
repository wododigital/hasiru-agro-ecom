import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { audit, listAudit } from '../src/audit';
import { upsertRequireUpdate, withTx, excluded, pageAll } from '../src/db';
import { emit } from '../src/events';
import { integrationCall, NotConfiguredError } from '../src/http';
import { orderNumber } from '../src/ids';
import { captureError, listErrorIssues, setIssueStatus } from '../src/observability';
import { rateLimit } from '../src/rate-limit';
import { coreAuditLog, coreErrorEvent, coreErrorIssue, coreIntegrationLog, coreSequence, coreSettings } from '../src/schema';
import { invoiceNumber, nextInSequence } from '../src/sequence';
import { defineSettings, getSettings, getSettingsForAdmin, setSettings } from '../src/settings';
import { createTestDb, queuedJobs, seedMinimal, TEST_NOW, fixedClock, type TestDb } from '../src/testing';

let t: TestDb;

beforeAll(async () => {
  process.env.INTERNAL_SECRET = 'z'.repeat(40);
  process.env.SETTINGS_MASTER_KEY = `1:${randomBytes(32).toString('base64')}`;
  t = await createTestDb('wp-00b-db');
  await seedMinimal(t.db);
}, 60_000);

afterAll(async () => {
  await t?.close();
});

describe('core_sequence', () => {
  it('50 concurrent issuances are distinct and consecutive', async () => {
    const values = await Promise.all(Array.from({ length: 50 }, () => withTx((tx) => nextInSequence('concurrency', tx))));
    expect([...values].sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it('a rolled-back issuance leaves no gap', async () => {
    await expect(
      withTx(async (tx) => {
        await nextInSequence('gapless', tx);
        throw new Error('payment failed');
      }),
    ).rejects.toThrow('payment failed');
    expect(await withTx((tx) => nextInSequence('gapless', tx))).toBe(1);
  });

  it('formats order and invoice numbers', async () => {
    const n = await withTx((tx) => orderNumber(tx, { prefix: 'HA', at: TEST_NOW }));
    expect(n).toBe('HA-2610-00001');
    const inv = await withTx((tx) => invoiceNumber(tx, { at: TEST_NOW }));
    expect(inv).toBe('INV-2026-27-00001');
    const [row] = await t.db.select().from(coreSequence).where(eq(coreSequence.name, 'invoice:2026-27'));
    expect(row?.value).toBe(1);
  });
});

describe('db helpers', () => {
  it('upsertRequireUpdate refuses an empty update set and updates on conflict', async () => {
    await expect(upsertRequireUpdate(t.db, coreSequence, { name: 'u', value: 1 }, { target: coreSequence.name, set: {} })).rejects.toThrow(/empty/);
    await upsertRequireUpdate(t.db, coreSequence, { name: 'u', value: 1 }, { target: coreSequence.name, set: { value: 1 } });
    const rows = await upsertRequireUpdate(t.db, coreSequence, [{ name: 'u', value: 7 }, { name: 'v', value: 3 }], {
      target: coreSequence.name,
      set: { value: excluded(coreSequence.value) },
    });
    expect(rows.map((r) => [r.name, r.value])).toEqual([
      ['u', 7],
      ['v', 3],
    ]);
  });

  it('pageAll reads past the page size', async () => {
    const all = Array.from({ length: 25 }, (_, i) => i);
    const pages: number[][] = [];
    for await (const page of pageAll(async (limit, offset) => all.slice(offset, offset + limit), 10)) pages.push(page);
    expect(pages.map((p) => p.length)).toEqual([10, 10, 5]);
  });
});

describe('rateLimit', () => {
  it('counts within the window and resets after it', async () => {
    const clock = fixedClock();
    const hit = () => rateLimit('otp-send:+919876543210', { limit: 3, windowSec: 600, now: clock.now() });
    expect((await hit()).ok).toBe(true);
    expect((await hit()).ok).toBe(true);
    const third = await hit();
    expect(third).toMatchObject({ ok: true, count: 3, remaining: 0 });
    expect(third.resetAt.getTime()).toBe(TEST_NOW.getTime() + 600_000);
    clock.advance(599_000);
    expect((await hit()).ok).toBe(false);
    clock.advance(1_000);
    expect(await hit()).toMatchObject({ ok: true, count: 1 });
    expect((await rateLimit('otp-send:+919000000000', { limit: 3, windowSec: 600, now: clock.now() })).count).toBe(1);
  });

  it('is atomic under concurrent hits', async () => {
    const now = TEST_NOW;
    const results = await Promise.all(Array.from({ length: 20 }, () => rateLimit('login:1.2.3.4', { limit: 10, windowSec: 900, now })));
    expect(results.filter((r) => r.ok)).toHaveLength(10);
    expect(results.map((r) => r.count).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('rejects keys without a route id', async () => {
    await expect(rateLimit('just-a-subject', { limit: 1, windowSec: 1 })).rejects.toThrow(/routeId/);
  });
});

describe('settings', () => {
  const def = defineSettings('payments', z.object({
    merchantId: z.string().optional(),
    clientSecret: z.string().min(8).meta({ secret: true }).optional(),
    advancePct: z.number().int().min(0).max(100).default(30),
  }));

  it('stores secrets sealed, reads them decrypted, shows admins only a mask, audits without plaintext', async () => {
    await setSettings(def, { merchantId: 'M123', clientSecret: 'sk_live_abcdef123456', advancePct: 40 }, { actorId: null });
    expect(await getSettings(def)).toEqual({ merchantId: 'M123', clientSecret: 'sk_live_abcdef123456', advancePct: 40 });

    const raw = await t.db.select().from(coreSettings).where(eq(coreSettings.module, 'payments'));
    const secretRow = raw.find((r) => r.key === 'clientSecret')!;
    expect(secretRow.isSecret).toBe(true);
    expect(secretRow.keyVersion).toBe(1);
    expect(JSON.stringify(raw)).not.toContain('abcdef');

    const admin = await getSettingsForAdmin(def);
    expect(admin.secrets.clientSecret).toEqual({ configured: true, masked: '••••3456' });
    expect(JSON.stringify(admin)).not.toContain('abcdef');

    const rows = await t.db.select().from(coreAuditLog).where(eq(coreAuditLog.entityId, 'payments'));
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain('abcdef');
    expect(rows[0]!.after).toMatchObject({ merchantId: 'M123', secrets: { clientSecret: 'replaced' } });
  });

  it('keeps a secret on empty input, clears it on null, validates the rest', async () => {
    await setSettings(def, { clientSecret: '', merchantId: 'M999' }, { actorId: null });
    expect(await getSettings(def)).toMatchObject({ merchantId: 'M999', clientSecret: 'sk_live_abcdef123456' });
    await setSettings(def, { clientSecret: null }, { actorId: null });
    expect((await getSettings(def)).clientSecret).toBeUndefined();
    await expect(setSettings(def, { advancePct: 150 }, { actorId: null })).rejects.toThrow();
    await expect(setSettings(def, { nope: 1 }, { actorId: null })).rejects.toThrow(/unknown setting/);
  });

  it('a partial update leaves the other stored fields alone (zod fills defaults through .partial())', async () => {
    await setSettings(def, { merchantId: 'M777', advancePct: 55 }, { actorId: null });
    await setSettings(def, { merchantId: 'M778' }, { actorId: null });
    expect(await getSettings(def)).toMatchObject({ merchantId: 'M778', advancePct: 55 });
  });

  it('refuses a tampered stored secret', async () => {
    await setSettings(def, { clientSecret: 'sk_live_zzzzzz999999' }, { actorId: null });
    const [row] = await t.db.select().from(coreSettings).where(sql`${coreSettings.module} = 'payments' and ${coreSettings.key} = 'clientSecret'`);
    const v = row!.value as { ct: string };
    const ct = Buffer.from(v.ct, 'base64');
    ct[0] = ct[0]! ^ 1;
    await t.db.update(coreSettings).set({ value: { ...v, ct: ct.toString('base64') } }).where(sql`${coreSettings.module} = 'payments' and ${coreSettings.key} = 'clientSecret'`);
    await expect(getSettings(def)).rejects.toThrow();
  });
});

describe('events', () => {
  it('emit inside a transaction enqueues exactly one job, and none when it rolls back', async () => {
    const before = (await queuedJobs(t.db, 'core.event')).length;
    await withTx((tx) => emit('order.placed', { orderId: 'o1', orderNumber: 'HA-2610-00001' }, { tx }));
    const after = await queuedJobs(t.db, 'core.event');
    expect(after).toHaveLength(before + 1);
    expect(after.at(-1)!.data).toMatchObject({ event: 'order.placed', payload: { orderId: 'o1' } });

    await expect(
      withTx(async (tx) => {
        await emit('order.placed', { orderId: 'o2', orderNumber: 'HA-2610-00002' }, { tx });
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');
    expect(await queuedJobs(t.db, 'core.event')).toHaveLength(before + 1);
  });

  it('refuses events outside the catalogue', async () => {
    await expect(emit('order.exploded' as never, {} as never)).rejects.toThrow(/catalogue/);
  });
});

describe('observability', () => {
  const boom = (message: string) => {
    const e = new Error(message);
    e.stack = `Error: ${message}\n    at placeOrder (/app/packages/checkout/src/server/place.ts:10:5)`;
    return e;
  };

  it('groups events under one issue, strips query strings and reopens resolved issues', async () => {
    const id1 = await captureError(boom('stock gone for v1'), { route: '/checkout', url: '/checkout?token=secret', method: 'POST' });
    const id2 = await captureError(boom('stock gone for v2'), { route: '/checkout' });
    expect(id1).toBeTruthy();
    expect(id2).toBe(id1);
    const [issue] = await t.db.select().from(coreErrorIssue).where(eq(coreErrorIssue.id, id1!));
    expect(issue).toMatchObject({ count: 2, status: 'open', title: 'Error: stock gone for v1' });
    const events = await t.db.select().from(coreErrorEvent).where(eq(coreErrorEvent.issueId, id1!));
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.url)).toContain('/checkout');
    expect(JSON.stringify(events)).not.toContain('token=secret');

    await setIssueStatus(id1!, 'resolved');
    await captureError(boom('again'), { route: '/checkout' });
    expect((await listErrorIssues({ status: 'open' })).map((i) => i.id)).toContain(id1);
  });
});

describe('integrationCall', () => {
  it('logs ok, skipped and failed calls; a failure emits integration.failed', async () => {
    const ok = await integrationCall('gmail', 'send', async () => new Response('{}', { status: 202 }), { ref: 'msg-1' });
    expect(ok.status).toBe('ok');
    const skipped = await integrationCall('whatsapp', 'send', async () => {
      throw new NotConfiguredError('whatsapp');
    });
    expect(skipped.status).toBe('skipped_not_configured');
    const failed = await integrationCall('phonepe', 'status', async () => {
      throw Object.assign(new Error('upstream 503'), { status: 503 });
    });
    expect(failed.status).toBe('failed');

    const rows = await t.db.select().from(coreIntegrationLog).orderBy(coreIntegrationLog.id);
    expect(rows.map((r) => [r.provider, r.status, r.httpStatus, r.ref])).toEqual([
      ['gmail', 'ok', 202, 'msg-1'],
      ['whatsapp', 'skipped_not_configured', null, null],
      ['phonepe', 'failed', 503, null],
    ]);
    const jobs = await queuedJobs(t.db, 'core.event');
    expect(jobs.some((j) => (j.data as { event: string }).event === 'integration.failed')).toBe(true);
  });
});

describe('audit', () => {
  it('appends rows and lists one entity history newest first', async () => {
    await audit({ actorId: null, actorType: 'system', action: 'product.update', entity: 'product', entityId: 'p1', before: { price: 1 }, after: { price: 2 } });
    await audit({ actorId: null, actorType: 'system', action: 'product.publish', entity: 'product', entityId: 'p1' });
    const rows = await listAudit({ entity: 'product', entityId: 'p1' });
    expect(rows.map((r) => r.action)).toEqual(['product.publish', 'product.update']);
  });
});
