import { setAuthProvider } from '@ecomkit/core/auth-context';
import { newId } from '@ecomkit/core/ids';
import type { TestDb } from '@ecomkit/core/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET as summary } from '../src/routes/api-cart';
import { POST } from '../src/routes/api-cart-lines';
import { GET as restore } from '../src/routes/api-cart-restore';
import { CART_CREATE_LIMIT } from '../src/server/cart';
import { findCart, restoreToken, type DrawerData } from '../src/server';
import { bind, cartDb, makeVariant } from './helpers';

let t: TestDb;
const BASE = 'http://shop.test';

function req(path: string, init: { method?: string; json?: unknown; form?: Record<string, string>; cookie?: string | null; sameOrigin?: boolean; ip?: string; raw?: string; type?: string } = {}) {
  const headers: Record<string, string> = { host: 'shop.test', 'x-real-ip': init.ip ?? '203.0.113.7' };
  if (init.sameOrigin !== false) headers['sec-fetch-site'] = 'same-origin';
  else headers['sec-fetch-site'] = 'cross-site';
  if (init.cookie) headers.cookie = `other=1; cart=${init.cookie}`;
  let body: string | undefined;
  if (init.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.json);
  } else if (init.form) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(init.form).toString();
  } else if (init.raw !== undefined) {
    headers['content-type'] = init.type ?? 'text/plain';
    body = init.raw;
  }
  return new Request(BASE + path, { method: init.method ?? (body === undefined ? 'GET' : 'POST'), headers, body });
}

const cookieOf = (res: Response) => /cart=([A-Za-z0-9_-]{43});/.exec(res.headers.get('set-cookie') ?? '')?.[1] ?? null;

beforeAll(async () => {
  t = await cartDb('routes');
}, 120_000);

afterAll(async () => {
  setAuthProvider(async () => null);
  await t?.close();
});

beforeEach(() => {
  bind();
  setAuthProvider(async () => null);
});

describe('POST /api/cart/lines (JSON, the catalog buttons)', () => {
  it('creates the cart with an httpOnly cookie, then changes the line by delta', async () => {
    const v = await makeVariant(t, { listPaise: 10_000 });
    const first = await POST(req('/api/cart/lines', { json: { variantId: v.variantId, delta: 3 } }));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ qty: 3 });
    const setCookie = first.headers.get('set-cookie')!;
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    const token = cookieOf(first)!;
    const second = await POST(req('/api/cart/lines', { json: { variantId: v.variantId, delta: -1 }, cookie: token }));
    expect(await second.json()).toEqual({ qty: 2 });
    expect(second.headers.get('set-cookie')).toBeNull();

    const s = await summary(req('/api/cart', { cookie: token }));
    const data = (await s.json()) as DrawerData;
    expect(s.headers.get('cache-control')).toBe('no-store');
    expect(data).toMatchObject({ count: 2, countLabel: '2 items', total: 'Rs 200' });
    expect(data.lines[0]).toMatchObject({ qty: 2, total: 'Rs 200', available: true });
  });

  it('refuses cross-site posts, bad bodies, unknown and unpurchasable variants', async () => {
    const v = await makeVariant(t, { listPaise: 10_000 });
    const off = await makeVariant(t, { listPaise: 10_000, purchasable: false });
    expect((await POST(req('/api/cart/lines', { json: { variantId: v.variantId, delta: 1 }, sameOrigin: false }))).status).toBe(403);
    expect((await POST(req('/api/cart/lines', { json: { variantId: 'x', delta: 1 } }))).status).toBe(400);
    expect((await POST(req('/api/cart/lines', { json: { variantId: v.variantId, delta: 0 } }))).status).toBe(400);
    expect((await POST(req('/api/cart/lines', { raw: '{nope', type: 'application/json' }))).status).toBe(400);
    expect((await POST(req('/api/cart/lines', { raw: 'x'.repeat(5000), type: 'application/json' }))).status).toBe(413);
    expect((await POST(req('/api/cart/lines', { raw: 'hi' }))).status).toBe(415);
    expect((await POST(req('/api/cart/lines', { json: { variantId: newId(), delta: 1 } }))).status).toBe(404);
    expect((await POST(req('/api/cart/lines', { json: { variantId: off.variantId, delta: 1 } }))).status).toBe(409);
  });

  it('limits new carts per address (an existing cart keeps working)', async () => {
    const v = await makeVariant(t, { listPaise: 10_000 });
    const ip = '198.51.100.20';
    let token: string | null = null;
    for (let i = 0; i < CART_CREATE_LIMIT.limit; i++) {
      const res = await POST(req('/api/cart/lines', { json: { variantId: v.variantId, delta: 1 }, ip }));
      expect(res.status).toBe(200);
      token ??= cookieOf(res);
    }
    expect((await POST(req('/api/cart/lines', { json: { variantId: v.variantId, delta: 1 }, ip }))).status).toBe(429);
    expect((await POST(req('/api/cart/lines', { json: { variantId: v.variantId, delta: 1 }, ip, cookie: token }))).status).toBe(200);
  });
});

describe('POST /api/cart/lines (no-JS form)', () => {
  it('adds and answers 303 to /cart, or /checkout for Buy now', async () => {
    const v = await makeVariant(t, { listPaise: 10_000 });
    const add = await POST(req('/api/cart/lines', { form: { variantId: v.variantId, qty: '4', intent: 'add' } }));
    expect(add.status).toBe(303);
    expect(add.headers.get('location')).toBe('/cart');
    const token = cookieOf(add)!;
    const buy = await POST(req('/api/cart/lines', { form: { variantId: v.variantId, qty: '1', intent: 'buy' }, cookie: token }));
    expect(buy.headers.get('location')).toBe('/checkout');
    expect(((await (await summary(req('/api/cart', { cookie: token }))).json()) as DrawerData).count).toBe(5);
    const bad = await POST(req('/api/cart/lines', { form: { variantId: newId(), qty: '1' } }));
    expect(bad.headers.get('location')).toBe('/cart?error=unknown_variant');
  });
});

describe('GET /api/cart/restore', () => {
  it('sets a new cookie and lands on /cart; bad links land on /cart with a notice', async () => {
    const v = await makeVariant(t, { listPaise: 10_000 });
    const made = await POST(req('/api/cart/lines', { json: { variantId: v.variantId, delta: 2 } }));
    const token = cookieOf(made)!;
    const link = await restoreToken((await findCart({ token, customerId: null }))!.id);
    const res = await restore(req(`/api/cart/restore?t=${encodeURIComponent(link)}`));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/cart');
    const fresh = cookieOf(res)!;
    expect(fresh).not.toBe(token);
    expect(((await (await summary(req('/api/cart', { cookie: fresh }))).json()) as DrawerData).count).toBe(2);
    const bad = await restore(req('/api/cart/restore?t=nope'));
    expect(bad.headers.get('location')).toBe('/cart?error=restore_invalid');
  });

  it('sends a customer cart link to sign-in when someone else opens it', async () => {
    const v = await makeVariant(t, { listPaise: 10_000 });
    const owner = newId();
    setAuthProvider(async () => ({
      getViewer: async () => ({ kind: 'customer', userId: owner, customerId: owner, name: null, phone: null, email: null }),
      requirePermission: async () => {
        throw new Error('no');
      },
      requireOwner: async () => {
        throw new Error('no');
      },
    }));
    await POST(req('/api/cart/lines', { json: { variantId: v.variantId, delta: 1 } }));
    const link = await restoreToken((await findCart({ token: null, customerId: owner }))!.id);
    setAuthProvider(async () => null);
    const res = await restore(req(`/api/cart/restore?t=${encodeURIComponent(link)}`));
    expect(res.headers.get('location')).toBe('/account/login?next=%2Fcart');
  });
});
