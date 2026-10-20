// The cart HTTP contract (A04-10, implemented by the cart module): POST /api/cart/lines { variantId, delta } -> { qty },
// then a `cart:changed` window event. A delta always adds to what is in the cart (A11), it never replaces.
// ponytail: same job as catalog's internal changeCartLine; swap for a shared client export once catalog or cart ships one.
export async function addToCart(lines: readonly { variantId: string; qty: number }[]): Promise<boolean> {
  try {
    for (const l of lines) {
      if (!(l.qty > 0)) continue;
      const res = await fetch('/api/cart/lines', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ variantId: l.variantId, delta: l.qty }),
      });
      if (!res.ok) return false;
    }
    window.dispatchEvent(new CustomEvent('cart:changed'));
    return true;
  } catch {
    return false;
  }
}
