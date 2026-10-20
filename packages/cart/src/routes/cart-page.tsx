import type { Metadata } from 'next';
import { Suspense } from 'react';
import { cartRuntime, currentCartContext, getCartView, readCartSettings } from '../server';
import { CartPageView, CartSkeleton } from '../ui/CartPage';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export function generateMetadata(): Metadata {
  return { title: cartRuntime().messages.page.metaTitle, robots: { index: false, follow: false } };
}

async function CartContent({ searchParams }: Props) {
  const rt = cartRuntime();
  const [ctx, sp, settings] = await Promise.all([currentCartContext(), searchParams, readCartSettings()]);
  const view = await getCartView(ctx);
  const blocks = view?.lines.length ? (rt.registry?.list('cartBlocks') ?? []).filter((b) => b.placement !== 'checkout-summary') : [];
  const components = await Promise.all(blocks.map((b) => b.component()));
  const code = typeof sp.error === 'string' ? sp.error : null;
  return <CartPageView view={view} messages={rt.messages} blockComponents={components} inputsHref={settings.inputsHref} notice={code ? (rt.messages.notices[code] ?? null) : null} />;
}

/** /cart: server-rendered from the cookie cart; request-time, so it streams inside its own Suspense boundary. */
export default function CartPage(props: Props) {
  return (
    <Suspense fallback={<CartSkeleton label={cartRuntime().messages.page.loading} />}>
      <CartContent {...props} />
    </Suspense>
  );
}
