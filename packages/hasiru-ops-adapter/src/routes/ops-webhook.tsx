import { clientIp, hashIp, PayloadTooLargeError, readRawBody } from '@ecomkit/core/http';
import { rateLimit } from '@ecomkit/core/rate-limit';
import { getSettings } from '@ecomkit/core/settings';
import { acceptStatusCallback } from '@ecomkit/erp-sync/server';
import { opsSettings } from '../server/adapter';
import { mockSecret, verifyRequest } from '../server/signing';

const unauthorized = () => Response.json({ error: 'unauthorized' }, { status: 401 });

/**
 * POST /api/webhooks/ops: order status callbacks (packed, dispatched, delivered) from the operations app.
 * Same HMAC scheme as orders out (timestamp + nonce + method + path + body), 5-minute window, nonce stored once.
 * Server to server: no cookies, so no same-origin check; rate limited per caller.
 */
export async function POST(req: Request): Promise<Response> {
  const limit = await rateLimit(`ops-webhook:${hashIp(clientIp(req)) ?? 'local'}`, { limit: 120, windowSec: 60 });
  if (!limit.ok) return Response.json({ error: 'too many requests' }, { status: 429 });
  const s = await getSettings(opsSettings);
  const secret = s.transport === 'mock' ? mockSecret() : s.opsHmacSecret;
  if (!secret) return new Response(null, { status: 404 });

  let raw: string;
  try {
    raw = (await readRawBody(req, 64 * 1024)).toString('utf8');
  } catch (err) {
    if (err instanceof PayloadTooLargeError) return new Response(null, { status: 413 });
    throw err;
  }
  const url = new URL(req.url);
  const verified = verifyRequest({ method: 'POST', path: `${url.pathname}${url.search}`, body: raw, headers: req.headers, secret });
  if (!verified.ok) return unauthorized();

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  const result = await acceptStatusCallback(verified.nonce, body);
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ ok: true, outcome: result.outcome });
}
