import { BEACON_JS } from '../domain/beacon';

/** GET /b.js: the collector. Short cache so a changed collector reaches browsers within the hour. */
export function GET(): Response {
  return new Response(BEACON_JS, {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
      'x-content-type-options': 'nosniff',
    },
  });
}
