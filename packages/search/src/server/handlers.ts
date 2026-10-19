import { db } from '@ecomkit/core/db';
import { hashIp } from '@ecomkit/core/http';
import { rateLimit } from '@ecomkit/core/rate-limit';
import { getSettings, defineSettings } from '@ecomkit/core/settings';
import { z } from 'zod';
import type { SearchIndex } from '../domain/build-index';
import { suggest } from '../domain/suggest';
import { searchSettingsSchema } from '../settings';
import { prepared } from './index-cache';
import { logInputSchema, logSearch } from './log';

export const searchSettings = defineSettings('search', searchSettingsSchema);

type GetIndex = () => Promise<SearchIndex>;

const json = (body: unknown, init: ResponseInit & { headers?: Record<string, string> } = {}) =>
  new Response(JSON.stringify(body), { ...init, headers: { 'content-type': 'application/json; charset=utf-8', ...init.headers } });

const suggestQuery = z.object({ q: z.string().trim().min(2).max(80), limit: z.coerce.number().int().min(1).max(12).catch(8) });

/** GET /api/search/suggest?q= : typeahead over the cached index (no database round trip). */
export function suggestHandler(getIndex: GetIndex) {
  return async function GET(request: Request): Promise<Response> {
    const params = new URL(request.url).searchParams;
    const parsed = suggestQuery.safeParse({ q: params.get('q') ?? '', limit: params.get('limit') ?? undefined });
    if (!parsed.success) return json({ items: [] }, { headers: { 'cache-control': 'public, max-age=300' } });
    const items = suggest(prepared(await getIndex()).suggest, parsed.data.q, parsed.data.limit);
    return json({ items }, { headers: { 'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600' } });
  };
}

/** GET /facets.json : the static facet index with an ETag (304 when unchanged). */
export function facetsHandler(getIndex: GetIndex) {
  return async function GET(request: Request): Promise<Response> {
    const index = await getIndex();
    const etag = `"${index.version}-${Date.parse(index.generatedAt).toString(36)}-${index.ids.length}"`;
    const headers = { etag, 'cache-control': 'public, max-age=300, stale-while-revalidate=86400' };
    if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
    return json(index, { headers });
  };
}

function clientIp(request: Request): string | null {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || null;
}

/** POST /api/search/log : zero-result filter combinations from the listing (sendBeacon). Rate limited per IP. */
export function logHandler() {
  return async function POST(request: Request): Promise<Response> {
    const text = await request.text();
    if (text.length > 2048) return new Response(null, { status: 413 });
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return new Response(null, { status: 400 });
    }
    const parsed = logInputSchema.safeParse(body);
    if (!parsed.success) return new Response(null, { status: 400 });
    const limit = await rateLimit(`search-log:${hashIp(clientIp(request)) ?? 'anon'}`, { limit: 30, windowSec: 60 });
    if (!limit.ok) return new Response(null, { status: 429 });
    const settings = await getSettings(searchSettings);
    if (settings.logQueries) await logSearch(db, parsed.data);
    return new Response(null, { status: 204 });
  };
}
