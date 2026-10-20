import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const revalidateTag = vi.fn();
vi.mock('next/cache', () => ({ revalidateTag }));

const { POST } = await import('../src/routes/revalidate');
const { invalidateTags, revalidateRequest, SIGNATURE_HEADER, tags } = await import('../src/cache-tags');

const URL_ = 'http://127.0.0.1:3000/api/internal/revalidate';
const call = (body: string, headers: Record<string, string> = {}, url = URL_) => POST(new Request(url, { method: 'POST', body, headers }));

beforeAll(() => {
  process.env.INTERNAL_SECRET = 'r'.repeat(40);
});
beforeEach(() => revalidateTag.mockClear());

describe('POST /api/internal/revalidate', () => {
  it('expires signed tags', async () => {
    const { body, signature } = revalidateRequest([tags.product('p1'), tags.catalog]);
    const res = await call(body, { [SIGNATURE_HEADER]: signature });
    expect(res.status).toBe(200);
    expect(revalidateTag.mock.calls).toEqual([
      ['product:p1', { expire: 0 }],
      ['catalog', { expire: 0 }],
    ]);
    // next start itself adds the socket address as x-forwarded-for: a loopback entry is the worker's direct call
    expect((await call(body, { [SIGNATURE_HEADER]: signature, 'x-forwarded-for': '::ffff:127.0.0.1' })).status).toBe(200);
  });

  it('refuses forged, stale, proxied, non-loopback and malformed requests', async () => {
    const { body, signature } = revalidateRequest([tags.catalog]);
    expect((await call(body, { [SIGNATURE_HEADER]: '0'.repeat(64) })).status).toBe(401);
    expect((await call(body.replace('catalog', 'nav'), { [SIGNATURE_HEADER]: signature })).status).toBe(401);
    const stale = revalidateRequest([tags.catalog], Date.now() - 10 * 60_000);
    expect((await call(stale.body, { [SIGNATURE_HEADER]: stale.signature })).status).toBe(401);
    expect((await call(body, { [SIGNATURE_HEADER]: signature, 'x-forwarded-for': '1.2.3.4' })).status).toBe(404);
    expect((await call(body, { [SIGNATURE_HEADER]: signature, 'x-forwarded-for': '127.0.0.1', 'x-real-ip': '127.0.0.1' })).status).toBe(404);
    expect((await call(body, { [SIGNATURE_HEADER]: signature }, 'http://shop.example/api/internal/revalidate')).status).toBe(404);
    const bad = revalidateRequest(['../etc']);
    expect((await call(bad.body, { [SIGNATURE_HEADER]: bad.signature })).status).toBe(400);
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});

describe('invalidateTags outside Next', () => {
  let server: Server;
  beforeAll(async () => {
    // Stand-in for the web process: hands the request to the real route handler.
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)]));
      const out = await call(Buffer.concat(chunks).toString('utf8'), headers, `http://127.0.0.1${req.url}`);
      res.writeHead(out.status).end(await out.text());
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    process.env.INTERNAL_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('falls back to the signed POST when revalidateTag cannot run here', async () => {
    revalidateTag.mockImplementationOnce(() => {
      throw new Error('Invariant: static generation store missing');
    });
    await invalidateTags([tags.stock('v9')]);
    expect(revalidateTag.mock.calls.map((c) => c[0])).toEqual(['stock:v9', 'stock:v9']);
  });
});
