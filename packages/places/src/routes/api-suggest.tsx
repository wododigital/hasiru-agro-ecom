import { z } from 'zod';
import { hashIp } from '@ecomkit/core/audit';
import { getSettings } from '@ecomkit/core/settings';
import { rateLimit } from '@ecomkit/core/rate-limit';
import { PINCODE_RE } from '../domain';
import { placesSettings } from '../settings';
import { places } from '../server/cache';
import { findPincode } from '../server/repo';
import { db } from '@ecomkit/core/db';

const query = z.object({
  q: z.string().trim().min(2).max(60),
  limit: z.coerce.number().int().min(1).max(12).optional(),
});

/** Edge cache: suggestions only change when districts are re-seeded or edited. */
const CACHE = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400';

export interface SuggestionJson {
  kind: 'district' | 'pincode' | 'alias';
  label: string;
  slug: string;
  name: string;
  stateCode: string;
  stateName: string;
  distanceKm: number | null;
}

/** GET /api/places/suggest?q=mys&limit=6. Six digits are looked up as a pincode first. */
export async function GET(request: Request): Promise<Response> {
  const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ suggestions: [] }, { status: 400, headers: { 'cache-control': 'no-store' } });

  const ip = request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const limited = await rateLimit(`places-suggest:${hashIp(ip)}`, { limit: 120, windowSec: 60 });
  if (!limited.ok) return Response.json({ suggestions: [] }, { status: 429, headers: { 'retry-after': '30', 'cache-control': 'no-store' } });

  const settings = await getSettings(placesSettings);
  const limit = parsed.data.limit ?? settings.suggest_limit;
  const q = parsed.data.q;
  const out: SuggestionJson[] = [];

  if (settings.pincode_lookup && PINCODE_RE.test(q)) {
    const hit = await findPincode(db, q);
    const district = hit?.districtSlug ? await places.getDistrict(hit.districtSlug) : null;
    if (hit && district) out.push({ kind: 'pincode', label: `${hit.pincode}, ${district.name}, ${district.stateName}`, slug: district.slug, name: district.name, stateCode: district.stateCode, stateName: district.stateName, distanceKm: district.distanceKm });
  }
  for (const s of await places.suggest(q, limit)) {
    out.push({ kind: s.kind, label: s.label, slug: s.district.slug, name: s.district.name, stateCode: s.district.stateCode, stateName: s.district.stateName, distanceKm: s.district.distanceKm });
  }
  return Response.json({ suggestions: out.slice(0, limit) }, { headers: { 'cache-control': CACHE } });
}
