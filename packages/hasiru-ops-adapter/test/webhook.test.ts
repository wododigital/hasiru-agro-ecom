import { setSettings } from '@ecomkit/core/settings';
import type { TestDb } from '@ecomkit/core/testing';
import { erpWebhookEvent } from '@ecomkit/erp-sync/schema';
import { configureErpSync } from '@ecomkit/erp-sync/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST } from '../src/routes/ops-webhook';
import { opsSettings, signRequest } from '../src/server';
import { opsDb } from './helpers';

const SECRET = 'shared-hmac-secret-for-tests-0123456789';
const URL_ = 'https://store.example.com/api/webhooks/ops';
const applied: { ecomOrderNumber: string; status: string }[] = [];

function call(body: string, opts: { secret?: string; now?: Date; headers?: Record<string, string> } = {}) {
  const headers = opts.headers ?? signRequest({ method: 'POST', path: '/api/webhooks/ops', body, secret: opts.secret ?? SECRET, ...(opts.now ? { now: opts.now } : {}) });
  return POST(new Request(URL_, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body }));
}

let t: TestDb;
beforeAll(async () => {
  t = await opsDb('ops-webhook');
  configureErpSync({ applyOrderStatus: async (s) => (s.ecomOrderNumber === 'T-1' ? (applied.push(s), true) : false) });
});
afterAll(async () => {
  await t?.close();
});

describe('POST /api/webhooks/ops', () => {
  it('404s while no secret is configured outside mock mode', async () => {
    await setSettings(opsSettings, { transport: 'ops-api' }, { actorId: null });
    expect((await call('{}')).status).toBe(404);
    await setSettings(opsSettings, { opsHmacSecret: SECRET }, { actorId: null });
  });

  it('applies a signed status once; a replayed nonce is a duplicate', async () => {
    const body = JSON.stringify({ ecomOrderNumber: 'T-1', status: 'dispatched' });
    const headers = signRequest({ method: 'POST', path: '/api/webhooks/ops', body, secret: SECRET });
    const first = await call(body, { headers });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, outcome: 'applied' });
    expect(await (await call(body, { headers })).json()).toEqual({ ok: true, outcome: 'duplicate' });
    expect(applied).toEqual([{ ecomOrderNumber: 'T-1', status: 'dispatched' }]);
    expect(await t.db.select().from(erpWebhookEvent)).toHaveLength(1);
  });

  it('rejects a bad signature, a stale timestamp, missing headers and a tampered body with the same 401', async () => {
    const body = JSON.stringify({ ecomOrderNumber: 'T-1', status: 'delivered' });
    const bad = [
      await call(body, { secret: 'wrong-secret' }),
      await call(body, { now: new Date(Date.now() - 10 * 60_000) }),
      await call(body, { headers: {} }),
      await POST(new Request(URL_, { method: 'POST', headers: signRequest({ method: 'POST', path: '/api/webhooks/ops', body, secret: SECRET }), body: body.replace('delivered', 'packed') })),
    ];
    for (const res of bad) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'unauthorized' });
    }
    expect(applied).toHaveLength(1);
  });

  it('rejects an invalid body after a valid signature, and oversized bodies', async () => {
    expect((await call(JSON.stringify({ ecomOrderNumber: 'T-1', status: 'refunded' }))).status).toBe(400);
    expect((await call('not json')).status).toBe(400);
    expect((await call(JSON.stringify({ pad: 'x'.repeat(70 * 1024) }))).status).toBe(413);
  });
});
