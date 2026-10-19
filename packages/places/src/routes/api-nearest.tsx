import { z } from 'zod';
import { places } from '../server/cache';

const query = z.object({ lat: z.coerce.number().min(6).max(38), lng: z.coerce.number().min(68).max(98) });

/** GET /api/places/nearest?lat=12.97&lng=77.59: the district whose HQ is closest ("use my location"). Not cached: it is personal. */
export async function GET(request: Request): Promise<Response> {
  const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ district: null }, { status: 400, headers: { 'cache-control': 'no-store' } });
  const district = await places.nearest(parsed.data.lat, parsed.data.lng);
  return Response.json({ district }, { headers: { 'cache-control': 'no-store' } });
}
