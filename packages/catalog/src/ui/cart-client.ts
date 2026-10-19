// The cart HTTP contract the catalog's buttons speak (implemented by the cart module, /api/cart/lines):
// POST JSON { variantId, delta } -> 200 { qty } (the line's new quantity), and the same path accepts a plain form
// post (variantId, qty, intent=add|buy) and answers 303 to /cart or /checkout, so buying works without JS.
export const CART_LINES_PATH = '/api/cart/lines';
export const CART_CHANGED_EVENT = 'cart:changed';

export async function changeCartLine(variantId: string, delta: number): Promise<number | null> {
  try {
    const res = await fetch(CART_LINES_PATH, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ variantId, delta }) });
    if (!res.ok) return null;
    const body = (await res.json()) as { qty?: unknown };
    window.dispatchEvent(new CustomEvent(CART_CHANGED_EVENT));
    return typeof body.qty === 'number' ? body.qty : null;
  } catch {
    return null;
  }
}
