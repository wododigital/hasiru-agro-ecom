import Link from 'next/link';
import type { ReactNode } from 'react';
import { copy } from '../../messages';

// Storefront shell of the proof store: a text header, no module islands.
export default function ShopLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="flex items-center gap-6 border-b border-border px-4 py-3">
        <Link href="/" className="font-semibold">{copy.brand}</Link>
        <Link href="/plants">{copy.shop}</Link>
        <Link href="/cart" className="ml-auto">{copy.cart}</Link>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </>
  );
}
