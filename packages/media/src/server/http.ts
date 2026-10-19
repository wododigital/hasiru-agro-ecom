// Route handlers: POST /api/media/upload and GET /media/[...path].
import { readdir } from 'node:fs/promises';
import { ForbiddenError, requirePermission } from '@ecomkit/core/auth-context';
import { PayloadTooLargeError, readRawBody } from '@ecomkit/core/http';
import { assetMetaSchema, CONTENT_TYPES, masterKey, MAX_UPLOAD_BYTES, parseMediaPath, pickDerivative, type DerivativeFormat } from '../domain';
import { mediaMessages, type MediaErrorCode } from '../messages';
import { getAsset, uploadFile, UploadError, verifySignedUrl } from './assets';
import { absPath, readKey } from './storage';

const IMMUTABLE = 'public, max-age=31536000, immutable';

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true; // same-origin form posts from older browsers; cookies are SameSite=Lax anyway
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Multipart upload (field `file`, plus optional alt, caption, source, licence, author, sourceUrl,
 * creditRequired, private). Staff with media.write only. JSON for fetch callers; a 303 back to the
 * library for the plain HTML form, so uploading works without JS.
 */
export async function handleUpload(req: Request): Promise<Response> {
  const html = (req.headers.get('accept') ?? '').includes('text/html');
  const fail = (code: MediaErrorCode, status: number) =>
    html
      ? new Response(null, { status: 303, headers: { location: `/admin/media?error=${code}` } })
      : Response.json({ ok: false, error: code, message: mediaMessages.errors[code] }, { status });

  if (!sameOrigin(req)) return fail('cross_origin', 403);
  let actorId: string;
  try {
    actorId = (await requirePermission('media.write')).userId;
  } catch (err) {
    if (err instanceof ForbiddenError) return fail('forbidden', 403);
    throw err;
  }

  let raw: Buffer;
  try {
    raw = await readRawBody(req, MAX_UPLOAD_BYTES + 256 * 1024);
  } catch (err) {
    if (err instanceof PayloadTooLargeError) return fail('too_large', 413);
    throw err;
  }
  const form = await new Response(new Uint8Array(raw), { headers: { 'content-type': req.headers.get('content-type') ?? '' } }).formData().catch(() => null);
  const file = form?.get('file');
  if (!form || !(file instanceof File) || file.size === 0) return fail('no_file', 400);

  const fields: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === 'string' && k !== 'file') fields[k] = v;
  const { private: priv, ...rest } = fields;
  const meta = assetMetaSchema.safeParse(rest);
  if (!meta.success) return fail('invalid', 400);

  try {
    const { asset, deduped } = await uploadFile({
      bytes: new Uint8Array(await file.arrayBuffer()),
      originalName: file.name,
      meta: meta.data,
      isPrivate: priv === 'on' || priv === 'true',
      createdBy: actorId,
    });
    if (html) return new Response(null, { status: 303, headers: { location: `/admin/media/${asset.id}` } });
    return Response.json(
      { ok: true, deduped, asset: { id: asset.id, kind: asset.kind, status: asset.status, width: asset.width, height: asset.height, isPrivate: asset.isPrivate } },
      { status: deduped ? 200 : 201 },
    );
  } catch (err) {
    if (err instanceof UploadError) return fail(err.code, err.status);
    throw err;
  }
}

const notFound = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'public, max-age=60' } });
const isMissing = (err: unknown) => (err as NodeJS.ErrnoException)?.code === 'ENOENT' || (err as NodeJS.ErrnoException)?.code === 'ENOTDIR';

async function serveKey(key: string, headers: Record<string, string>): Promise<Response> {
  try {
    const data = await readKey(key);
    const ext = key.slice(key.lastIndexOf('.') + 1);
    return new Response(new Uint8Array(data), {
      headers: { 'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream', 'content-length': String(data.byteLength), 'x-content-type-options': 'nosniff', ...headers },
    });
  } catch (err) {
    if (isMissing(err)) return notFound();
    throw err;
  }
}

/**
 * /media/* : public masters and derivatives (immutable, safe for nginx to serve directly), the
 * width-negotiated URL the next/image loader produces (AVIF when accepted, `Vary: Accept`), and
 * signed private files. Paths are whitelisted by `parseMediaPath`.
 */
export async function handleMediaGet(req: Request, segments: readonly string[]): Promise<Response> {
  const path = parseMediaPath(segments);
  if (!path) return notFound();

  if (path.type === 'file') return serveKey(path.key, { 'cache-control': IMMUTABLE });

  if (path.type === 'negotiate') {
    let names: string[] = [];
    try {
      names = await readdir(absPath(`public/d/${path.base}`));
    } catch (err) {
      if (!isMissing(err)) throw err;
    }
    const available = names.flatMap((n) => {
      const m = /^(\d+)\.(avif|webp)$/.exec(n);
      return m ? [{ width: Number(m[1]), format: m[2] as DerivativeFormat }] : [];
    });
    const pick = pickDerivative(available, path.width, (req.headers.get('accept') ?? '').includes('image/avif'));
    if (pick) return serveKey(`public/d/${path.base}/${pick.width}.${pick.format}`, { 'cache-control': IMMUTABLE, vary: 'Accept' });
    // Derivatives not generated yet: the master, briefly cached so the real size takes over soon.
    return serveKey(masterKey(path.base), { 'cache-control': 'public, max-age=60', vary: 'Accept' });
  }

  const url = new URL(req.url);
  if (!verifySignedUrl(path.assetId, url.searchParams.get('e'), url.searchParams.get('t'))) return notFound();
  const asset = await getAsset(path.assetId);
  if (!asset) return notFound();
  try {
    const data = await readKey(asset.storageKey);
    const filename = encodeURIComponent(asset.originalName);
    return new Response(new Uint8Array(data), {
      headers: {
        'content-type': asset.mime,
        'content-length': String(data.byteLength),
        'content-disposition': `${asset.kind === 'image' ? 'inline' : 'attachment'}; filename*=UTF-8''${filename}`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "sandbox; default-src 'none'",
        'referrer-policy': 'no-referrer',
      },
    });
  } catch (err) {
    if (isMissing(err)) return notFound();
    throw err;
  }
}
