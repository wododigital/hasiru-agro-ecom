import { z } from 'zod';
import { hashIp } from '@ecomkit/core/audit';
import { db } from '@ecomkit/core/db';
import { rateLimit } from '@ecomkit/core/rate-limit';
import { getSettings } from '@ecomkit/core/settings';
import { PINCODE_RE } from '../domain';
import { places } from '../server/cache';
import { findPincode } from '../server/repo';
import { placesSettings } from '../settings';

const query = z.object({ code: z.string().trim().regex(PINCODE_RE) });

/**
 * GET /api/places/pincode?code=560001. `{ lookup: 'off' }` when no directory is loaded, so checkout falls back to
 * a free 6-digit field with the district picked from the typeahead; 404 `{ found: false }` for an unknown pincode.
 */
export async function GET(request: Request): Promise<Response> {
  const settings = await getSettings(placesSettings);
  if (!settings.pincode_lookup) return Response.json({ lookup: 'off' }, { headers: { 'cache-control': 'public, max-age=300' } });
  const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ found: false }, { status: 400, headers: { 'cache-control': 'no-store' } });

  const ip = request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const limited = await rateLimit(`places-pincode:${hashIp(ip)}`, { limit: 60, windowSec: 60 });
  if (!limited.ok) return Response.json({ found: false }, { status: 429, headers: { 'retry-after': '30', 'cache-control': 'no-store' } });

  const hit = await findPincode(db, parsed.data.code);
  if (!hit) return Response.json({ found: false }, { status: 404, headers: { 'cache-control': 'public, max-age=300' } });
  const district = hit.districtSlug ? await places.getDistrict(hit.districtSlug) : null;
  return Response.json(
    { found: true, pincode: hit.pincode, office: hit.officeName, stateCode: hit.stateCode, district },
    { headers: { 'cache-control': 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800' } },
  );
}
