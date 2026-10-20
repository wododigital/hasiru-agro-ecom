// Route handlers against real Postgres and files: upload permissions and refusals, public serving,
// width/format negotiation, signed private files.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ForbiddenError, NotFoundError, setAuthProvider } from '@ecomkit/core/auth-context';
import type { AuthContext, Permission, StaffViewer } from '@ecomkit/core/contracts';
import { createTestDb, type TestDb } from '@ecomkit/core/testing';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mediaLoader, mediaSrc } from '../src/domain';
import { getAsset, signedUrl, uploadFile, uploadImage } from '../src/server/assets';
import { handleMediaGet, handleUpload } from '../src/server/http';

let t: TestDb;
let root: string;
let permissions: Permission[] = ['media.write'];

const staff = (): StaffViewer => ({ kind: 'staff', userId: '0192f1e2-3456-7abc-8def-0123456789ab', name: 'Staff', email: 'staff@example.test', role: 'catalog_editor', permissions });
const fakeAuth: AuthContext = {
  getViewer: async () => staff(),
  requirePermission: async (p) => {
    if (!permissions.includes(p)) throw new ForbiddenError();
    return staff();
  },
  requireOwner: async () => {
    throw new NotFoundError();
  },
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'wp03-http-'));
  process.env.MEDIA_ROOT = root;
  process.env.INTERNAL_SECRET = 'h'.repeat(40);
  t = await createTestDb('wp-03-http', { schemas: ['core', 'media'] });
  setAuthProvider(async () => fakeAuth);
});

afterAll(async () => {
  await t?.close();
  await rm(root, { recursive: true, force: true });
});

let n = 0;
const photo = (w = 700, h = 500) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: (n++ * 37) % 256, g: 120, b: 60 } } })
    .jpeg()
    .toBuffer();

function uploadRequest(file: Blob, name: string, fields: Record<string, string> = {}, headers: Record<string, string> = {}): Request {
  const form = new FormData();
  form.set('file', file, name);
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return new Request('http://localhost/api/media/upload', { method: 'POST', body: form, headers: { accept: 'application/json', 'sec-fetch-site': 'same-origin', ...headers } });
}
const get = (path: string, accept = 'image/avif,image/webp,*/*') => {
  const url = new URL(path, 'http://localhost');
  return handleMediaGet(new Request(url, { headers: { accept } }), url.pathname.replace(/^\/media\//, '').split('/'));
};

describe('POST /api/media/upload', () => {
  it('stores an upload with its licence fields and returns 201, then 200 for the same bytes', async () => {
    const bytes = await photo();
    const res = await handleUpload(uploadRequest(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }), 'farm.jpg', { alt: 'Farm rows', licence: 'Own photo', source: 'client', creditRequired: '' }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; deduped: boolean; asset: { id: string; status: string } };
    expect(body).toMatchObject({ ok: true, deduped: false, asset: { status: 'processing' } });
    expect(await getAsset(body.asset.id)).toMatchObject({ alt: 'Farm rows', licence: 'Own photo', source: 'client', createdBy: staff().userId });

    const again = await handleUpload(uploadRequest(new Blob([new Uint8Array(bytes)]), 'copy.jpg'));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ deduped: true, asset: { id: body.asset.id } });
  });

  it('refuses SVG even when it claims to be a PNG', async () => {
    const svg = new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], { type: 'image/png' });
    const res = await handleUpload(uploadRequest(svg, 'logo.png'));
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ ok: false, error: 'svg_refused' });
  });

  it('403 without media.write, 403 cross-origin, 400 without a file, 400 on bad fields, 413 when too large', async () => {
    const jpg = new Blob([new Uint8Array(await photo())]);
    permissions = ['products.read'];
    expect((await handleUpload(uploadRequest(jpg, 'a.jpg'))).status).toBe(403);
    permissions = ['media.write'];
    expect((await handleUpload(uploadRequest(jpg, 'a.jpg', {}, { 'sec-fetch-site': 'cross-site', origin: 'https://attacker.example' }))).status).toBe(403);
    const empty = new Request('http://localhost/api/media/upload', { method: 'POST', body: new FormData(), headers: { accept: 'application/json', 'sec-fetch-site': 'same-origin' } });
    expect((await handleUpload(empty)).status).toBe(400);
    expect((await handleUpload(uploadRequest(jpg, 'a.jpg', { sourceUrl: 'javascript:alert(1)' }))).status).toBe(400);
    const huge = new Blob([new Uint8Array([0xff, 0xd8, 0xff]), new Uint8Array(13 * 1024 * 1024)]);
    const res = await handleUpload(uploadRequest(huge, 'huge.jpg'));
    expect(res.status).toBe(413);
  });

  it('a plain HTML form gets a 303 to the asset page, or back to the library with the error', async () => {
    const ok = await handleUpload(uploadRequest(new Blob([new Uint8Array(await photo())]), 'form.jpg', {}, { accept: 'text/html' }));
    expect(ok.status).toBe(303);
    expect(ok.headers.get('location')).toMatch(/^\/admin\/media\/[0-9a-f-]{36}$/);
    const bad = await handleUpload(uploadRequest(new Blob(['<svg/>']), 'x.svg', {}, { accept: 'text/html' }));
    expect(bad.status).toBe(303);
    expect(bad.headers.get('location')).toBe('/admin/media?error=svg_refused');
  });
});

describe('GET /media/*', () => {
  it('serves masters and derivatives immutably and negotiates AVIF/WebP by width', async () => {
    const { asset } = await uploadImage({ bytes: await photo(700, 500), originalName: 'serve.jpg', derive: 'inline' });
    const master = await get(mediaSrc(asset.storageKey));
    expect(master.status).toBe(200);
    expect(master.headers.get('content-type')).toBe('image/webp');
    expect(master.headers.get('cache-control')).toContain('immutable');
    expect(master.headers.get('x-content-type-options')).toBe('nosniff');

    const loaderUrl = mediaLoader({ src: mediaSrc(asset.storageKey), width: 384 });
    const avif = await get(loaderUrl);
    expect(avif.headers.get('content-type')).toBe('image/avif');
    expect(avif.headers.get('vary')).toBe('Accept');
    expect((await sharp(Buffer.from(await avif.arrayBuffer())).metadata()).width).toBe(480);

    const webp = await get(loaderUrl, 'image/webp,*/*');
    expect(webp.headers.get('content-type')).toBe('image/webp');

    const widest = await get(mediaLoader({ src: mediaSrc(asset.storageKey), width: 3840 }));
    expect((await sharp(Buffer.from(await widest.arrayBuffer())).metadata()).width).toBe(640);
  });

  it('falls back to the master, briefly cached, before derivatives exist', async () => {
    const { asset } = await uploadImage({ bytes: await photo(500, 400), originalName: 'pending.jpg', derive: 'none' });
    const res = await get(mediaLoader({ src: mediaSrc(asset.storageKey), width: 320 }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expect((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).width).toBe(500);
  });

  it('404s on traversal and on unknown files', async () => {
    expect((await handleMediaGet(new Request('http://localhost/media/x'), ['..', '..', 'etc', 'passwd'])).status).toBe(404);
    expect((await get(`/media/m/ab/${'0'.repeat(32)}.webp`)).status).toBe(404);
  });

  it('serves private files only with a valid, unexpired signature', async () => {
    const pdf = Buffer.from('%PDF-1.4\n% private quote\n%%EOF');
    const { asset } = await uploadFile({ bytes: pdf, originalName: 'Quote for farm.pdf' });
    const url = signedUrl(asset.id);
    const ok = await get(url);
    expect(ok.status).toBe(200);
    expect(Buffer.from(await ok.arrayBuffer())).toEqual(pdf);
    expect(ok.headers.get('content-type')).toBe('application/pdf');
    expect(ok.headers.get('content-disposition')).toBe("attachment; filename*=UTF-8''Quote%20for%20farm.pdf");
    expect(ok.headers.get('cache-control')).toBe('private, no-store');
    expect(ok.headers.get('content-security-policy')).toContain('sandbox');

    const expired = signedUrl(asset.id, { now: Date.now() - 3_600_000 });
    expect((await get(expired)).status).toBe(404);
    expect((await get(url.replace(/t=[0-9a-f]{4}/, 't=0000'))).status).toBe(404);
    const other = await uploadFile({ bytes: Buffer.from('%PDF-1.4\n% other\n%%EOF'), originalName: 'other.pdf' });
    expect((await get(url.replace(asset.id, other.asset.id))).status).toBe(404);
    expect((await get(`/media/s/${asset.id}`)).status).toBe(404);
    // the private tree is not reachable as a public path
    expect((await get(`/media/${asset.storageKey}`)).status).toBe(404);
  });
});
