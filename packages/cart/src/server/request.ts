// Request binding: the cart cookie and the signed-in customer, for pages, server actions and route handlers.
import { getViewer } from '@ecomkit/core/auth-context';
import { clientIp, hashIp } from '@ecomkit/core/http';
import { CART_COOKIE } from '../domain';
import { readCartSettings, type CartContext, type Mutation } from './cart';
import { getCartView, type CartView } from './view';

async function customerId(): Promise<string | null> {
  const viewer = await getViewer();
  return viewer.kind === 'customer' ? viewer.customerId : null;
}

/** Inside a page or server action (next/headers). */
export async function currentCartContext(): Promise<CartContext> {
  const { cookies, headers } = await import('next/headers');
  const [jar, h, customer] = await Promise.all([cookies(), headers(), customerId()]);
  return { token: jar.get(CART_COOKIE)?.value ?? null, customerId: customer, createSubject: hashIp(clientIp({ headers: h })) };
}

/** `getCart()`: the current visitor's cart view (null without one). Request-time only. */
export async function getCart(): Promise<CartView | null> {
  return getCartView(await currentCartContext());
}

/** Writes a newly issued cart token from a server action. */
export async function writeCartCookie(token: string): Promise<void> {
  const { cookies } = await import('next/headers');
  const { cookieDays } = await readCartSettings();
  (await cookies()).set(CART_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: cookieDays * 86_400 });
}

/**
 * Runs a cart mutation for the current request and writes the cookie when it created or adopted a cart, e.g.
 * `inRequest((ctx) => replacePackage(ctx, input))` from planting's add-package server action.
 */
export async function inRequest<T>(fn: (ctx: CartContext) => Promise<Mutation<T>>): Promise<T> {
  const m = await fn(await currentCartContext());
  if (m.issuedToken) await writeCartCookie(m.issuedToken);
  return m.result;
}

/** Route handlers: the context from a plain Request (testable without Next's request store). */
export async function cartContextFromRequest(req: Request): Promise<CartContext> {
  const raw = req.headers.get('cookie') ?? '';
  let token: string | null = null;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === CART_COOKIE) token = decodeURIComponent(v.join('='));
  }
  return { token, customerId: await customerId(), createSubject: hashIp(clientIp(req)) };
}

export async function cartCookieHeader(token: string): Promise<string> {
  const { cookieDays } = await readCartSettings();
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${CART_COOKIE}=${token}; Path=/; Max-Age=${cookieDays * 86_400}; HttpOnly; SameSite=Lax${secure}`;
}
