import { db } from '@ecomkit/core/db';
import { getSettings, defineSettings } from '@ecomkit/core/settings';
import { z } from 'zod';
import type { SearchIndex } from '../domain/build-index';
import { suggest } from '../domain/suggest';
import { searchSettingsSchema } from '../settings';
import { prepared } from './index-cache';
import { logInputSchema, logSearchLimited } from './log';

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
    // The beacon exists only for zero-result filter combinations.
    if (!parsed.success || parsed.data.results !== 0) return new Response(null, { status: 400 });
    const settings = await getSettings(searchSettings);
    if (settings.logQueries && !(await logSearchLimited(db, parsed.data, request))) return new Response(null, { status: 429 });
    return new Response(null, { status: 204 });
  };
}
