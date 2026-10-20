import type { ReactNode } from 'react';
import { SiteFooter, SiteHeader } from '../../src/shell/chrome';

// Storefront shell: header and footer read the cms menus (cached, tag nav) with static fallbacks.
export default function ShopLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main">{children}</main>
      <SiteFooter />
    </>
  );
}
