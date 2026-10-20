import { z } from 'zod';
import { clientIp, hashIp } from '@ecomkit/core/http';
import { rateLimit } from '@ecomkit/core/rate-limit';
import { getSettings } from '@ecomkit/core/settings';
import { quoteMethods, shippingRuntime } from '../server';
import { shippingSettings } from '../settings';

const query = z
  .object({
    pincode: z.string().trim().regex(/^[1-9]\d{5}$/).optional(),
    district: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80).optional(),
    state: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional(),
    /** Weight to deliver; defaults to 1 kg so the dates show for a single item. */
    kg: z.coerce.number().positive().max(100_000).default(1),
  })
  .refine((q) => q.pincode || q.district || q.state, { message: 'pincode or district required' });

const json = (status: number, body: object, cache = 'no-store') => Response.json(body, { status, headers: { 'cache-control': cache } });

/**
 * GET /api/delivery-check?pincode=560001&kg=12 (or `district=<slug>&state=KA`): every delivery method with its
 * dates and charge for that place and weight. A pincode needs the host's pincode directory binding; without it the
 * answer is 422 `pincode_lookup_off` and the caller asks for a district.
 */
export async function GET(req: Request): Promise<Response> {
  const parsed = query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return json(400, { ok: false, error: 'invalid' });

  const settings = await getSettings(shippingSettings);
  const limit = await rateLimit(`delivery-check:${hashIp(clientIp(req)) ?? 'unknown'}`, { limit: settings.delivery_check_rate_per_min, windowSec: 60 });
  if (!limit.ok) return json(429, { ok: false, error: 'rate_limited' });

  const q = parsed.data;
  let districtSlug = q.district ?? null;
  let stateCode = q.state ?? null;
  if (q.pincode) {
    const resolve = shippingRuntime().resolvePincode;
    if (!resolve) return json(422, { ok: false, error: 'pincode_lookup_off' });
    const hit = await resolve(q.pincode);
    if (!hit) return json(404, { ok: false, error: 'unknown_pincode' });
    districtSlug = hit.districtSlug;
    stateCode = hit.stateCode;
  }

  const methods = await quoteMethods({ lines: [], totalWeightKg: q.kg, address: { pincode: q.pincode ?? null, districtSlug, stateCode } });
  return json(200, { ok: true, districtSlug, stateCode, methods }, 'private, max-age=60');
}
