import { clientIp, hashIp, PayloadTooLargeError, readRawBody } from '@ecomkit/core/http';
import { formGuards } from '@ecomkit/core/validation';
import { rateLimit } from '@ecomkit/core/rate-limit';
import { getSettings } from '@ecomkit/core/settings';
import { z } from 'zod';
import { notifyMeSchema } from '../domain';
import { inventorySettings, subscribe, SubscribeError } from '../server';

const json = (status: number, body: object) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

/**
 * POST /api/notify-me `{ variantId, phone?, email?, consent: true }`: back-in-stock subscription.
 * 10 per hour per IP; a filled honeypot field gets a quiet 202 so bots learn nothing.
 */
export async function POST(req: Request): Promise<Response> {
  if (!(await getSettings(inventorySettings)).notifyMeEnabled) return json(404, { ok: false });
  let body: unknown;
  try {
    body = JSON.parse((await readRawBody(req, 4096)).toString('utf8'));
  } catch (err) {
    return json(err instanceof PayloadTooLargeError ? 413 : 400, { ok: false });
  }
  if (typeof body !== 'object' || body === null) return json(400, { ok: false });
  const honey = (body as Record<string, unknown>)[formGuards.honeypotField];
  if (typeof honey === 'string' && honey.trim()) return json(202, { ok: true });

  const limit = await rateLimit(`notify-me:${hashIp(clientIp(req)) ?? 'unknown'}`, { limit: 10, windowSec: 3600 });
  if (!limit.ok) return json(429, { ok: false, error: 'rate_limited' });

  const parsed = notifyMeSchema.safeParse(body);
  if (!parsed.success) return json(400, { ok: false, fieldErrors: z.flattenError(parsed.error).fieldErrors });
  try {
    await subscribe(parsed.data);
  } catch (err) {
    if (err instanceof SubscribeError) return json(err.code === 'unknown_variant' ? 404 : 400, { ok: false, error: err.code });
    throw err;
  }
  return json(201, { ok: true });
}
