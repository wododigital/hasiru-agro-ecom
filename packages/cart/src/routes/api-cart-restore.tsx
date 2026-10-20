import { isSameOrigin } from '@ecomkit/core/http';
import { cartRuntime } from '../server/runtime';
import { cartContextFromRequest, cartCookieHeader, peekRestore, restoreCart } from '../server';

const to = (location: string, cookie?: string) =>
  new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store', ...(cookie ? { 'set-cookie': cookie } : {}) } });

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * GET /api/cart/restore?t=<token>: the link in reminder messages. Changes nothing (link-preview bots fetch it):
 * a small noindex, unframeable page with the item count and one button that POSTs the token back.
 */
export async function GET(req: Request): Promise<Response> {
  const token = (new URL(req.url).searchParams.get('t') ?? '').slice(0, 600);
  const peek = await peekRestore(await cartContextFromRequest(req), token);
  if (!peek.ok) return to(`/cart?error=restore_${peek.reason}`);
  const m = cartRuntime().messages.restore;
  const lead = peek.needsSignIn ? m.signIn : m.items(peek.itemCount);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${esc(m.title)}</title><style>body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f6f4;color:#1a1a1a}main{max-width:26rem;padding:2rem;text-align:center}button{font:inherit;padding:.9rem 1.6rem;border:0;border-radius:.5rem;background:#1a1a1a;color:#fff;cursor:pointer}a{color:inherit}</style></head><body><main><h1>${esc(m.title)}</h1><p>${esc(lead)}</p><form method="post" action="/api/cart/restore"><input type="hidden" name="t" value="${esc(token)}"><button type="submit">${esc(m.open)}</button></form><p><a href="/">${esc(m.back)}</a></p></main></body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      'x-frame-options': 'DENY',
    },
  });
}

/** POST /api/cart/restore (same origin only): opens the cart on this device, then lands on /cart. */
export async function POST(req: Request): Promise<Response> {
  if (!isSameOrigin(req)) return new Response(null, { status: 403 });
  const form = await req.formData().catch(() => null);
  const raw = form?.get('t');
  const token = (typeof raw === 'string' ? raw : '').slice(0, 600);
  const result = await restoreCart(await cartContextFromRequest(req), token);
  if (result.ok) return to('/cart', result.issuedToken ? await cartCookieHeader(result.issuedToken) : undefined);
  if (result.reason === 'sign_in') return to(`/account/login?next=${encodeURIComponent('/cart')}`);
  return to(`/cart?error=restore_${result.reason}`);
}
