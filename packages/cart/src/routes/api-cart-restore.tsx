import { cartContextFromRequest, cartCookieHeader, restoreCart } from '../server';

const to = (location: string, cookie?: string) =>
  new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store', ...(cookie ? { 'set-cookie': cookie } : {}) } });

/** GET /api/cart/restore?t=<token>: opens the cart a reminder link points at on this device, then lands on /cart. */
export async function GET(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get('t') ?? '';
  const result = await restoreCart(await cartContextFromRequest(req), token.slice(0, 200));
  if (result.ok) return to('/cart', result.issuedToken ? await cartCookieHeader(result.issuedToken) : undefined);
  if (result.reason === 'sign_in') return to(`/account/login?next=${encodeURIComponent('/cart')}`);
  return to(`/cart?error=restore_${result.reason}`);
}
