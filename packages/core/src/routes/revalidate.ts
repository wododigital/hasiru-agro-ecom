import { revalidateTag } from 'next/cache';
import { z } from 'zod';
import { SIGNATURE_HEADER, TAG_RE } from '../cache-tags';
import { readRawBody } from '../http/raw-body';
import { verifyInternal } from '../http/hmac';

const bodySchema = z.object({ tags: z.array(z.string().regex(TAG_RE)).min(1).max(500), ts: z.number().int() });
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

/**
 * POST /api/internal/revalidate: the worker's way to expire cache tags in the web process.
 * Loopback only (nginx always adds x-forwarded-for, so a proxied request is refused), HMAC-signed
 * with the derived `revalidate` key, timestamp within 5 minutes.
 */
export async function POST(req: Request): Promise<Response> {
  const host = new URL(req.url).hostname.replace(/^\[|\]$/g, '');
  if (!LOOPBACK.has(host) || req.headers.has('x-forwarded-for') || req.headers.has('x-real-ip')) return new Response(null, { status: 404 });
  let raw: Buffer;
  try {
    raw = await readRawBody(req, 64 * 1024);
  } catch {
    return new Response(null, { status: 413 });
  }
  if (!verifyInternal(raw, req.headers.get(SIGNATURE_HEADER), 'revalidate')) return new Response(null, { status: 401 });
  const parsed = bodySchema.safeParse(JSON.parse(raw.toString('utf8') || 'null'));
  if (!parsed.success) return new Response(null, { status: 400 });
  if (Math.abs(Date.now() - parsed.data.ts) > 300_000) return new Response(null, { status: 401 });
  for (const tag of parsed.data.tags) revalidateTag(tag, { expire: 0 });
  return Response.json({ revalidated: parsed.data.tags.length });
}
