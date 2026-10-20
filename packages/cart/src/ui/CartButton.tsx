import { cartCount, cartRuntime, currentCartContext } from '../server';
import { CartDrawerIsland } from './CartDrawerIsland';

/**
 * Header cart button + drawer for the host shell. Reads the cookie, so the host renders it inside Suspense
 * (fallback: `<CartDrawerIsland initialCount={0} ... />` or nothing).
 */
export async function CartButton() {
  const m = cartRuntime().messages.drawer;
  const count = await cartCount(await currentCartContext());
  return <CartDrawerIsland initialCount={count} labels={{ open: m.open, title: m.title, viewCart: m.viewCart, checkout: m.checkout, total: m.total, loading: m.loading, error: m.error, empty: m.empty }} />;
}
