import { isSameOrigin, PayloadTooLargeError, readRawBody } from '@ecomkit/core/http';
import { z } from 'zod';
import { deltaSchema, formAddSchema } from '../domain';
import { addLine, CartError, cartContextFromRequest, cartCookieHeader, changeQty, type CartErrorCode } from '../server';

const STATUS: Record<CartErrorCode, number> = { unknown_variant: 404, not_purchasable: 409, too_many_lines: 409, rate_limited: 429 };

async function headers(issuedToken: string | null): Promise<Record<string, string>> {
  return { 'cache-control': 'no-store', ...(issuedToken ? { 'set-cookie': await cartCookieHeader(issuedToken) } : {}) };
}

/**
 * POST /api/cart/lines, the catalog buttons' contract:
 * - JSON `{ variantId, delta }` -> 200 `{ qty }` (the product line's new quantity; 0 when it went);
 * - a plain form post `variantId, qty, intent=add|buy` -> 303 to /cart or /checkout, so buying works without JS.
 * Same-origin only (cookie-authenticated, state-changing); the body is capped at 4 KB.
 */
export async function POST(req: Request): Promise<Response> {
  if (!isSameOrigin(req)) return Response.json({ ok: false, error: 'forbidden' }, { status: 403 });
  let raw: string;
  try {
    raw = (await readRawBody(req, 4096)).toString('utf8');
  } catch (err) {
    return Response.json({ ok: false }, { status: err instanceof PayloadTooLargeError ? 413 : 400 });
  }
  const ctx = await cartContextFromRequest(req);
  const type = req.headers.get('content-type') ?? '';

  if (type.startsWith('application/json')) {
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return Response.json({ ok: false }, { status: 400 });
    }
    const parsed = deltaSchema.safeParse(body);
    if (!parsed.success) return Response.json({ ok: false, fieldErrors: z.flattenError(parsed.error).fieldErrors }, { status: 400 });
    try {
      const m = await changeQty(ctx, parsed.data);
      return Response.json({ qty: m.result }, { headers: await headers(m.issuedToken) });
    } catch (err) {
      if (err instanceof CartError) return Response.json({ ok: false, error: err.code }, { status: STATUS[err.code] });
      throw err;
    }
  }

  if (type.startsWith('application/x-www-form-urlencoded')) {
    const parsed = formAddSchema.safeParse(Object.fromEntries(new URLSearchParams(raw)));
    if (!parsed.success) return new Response(null, { status: 303, headers: { location: '/cart?error=unknown_variant' } });
    try {
      const m = await addLine(ctx, { variantId: parsed.data.variantId, qty: parsed.data.qty });
      return new Response(null, { status: 303, headers: { location: parsed.data.intent === 'buy' ? '/checkout' : '/cart', ...(await headers(m.issuedToken)) } });
    } catch (err) {
      if (err instanceof CartError) return new Response(null, { status: 303, headers: { location: `/cart?error=${err.code}` } });
      throw err;
    }
  }
  return Response.json({ ok: false, error: 'unsupported_media_type' }, { status: 415 });
}
