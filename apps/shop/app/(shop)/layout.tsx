import { ProductRail } from '@ecomkit/catalog/ui';
import { CompostCalculator, PlantCalculator, PlantCalculatorLauncher } from '@ecomkit/farm-calculators/ui';
import { TagScripts } from '@ecomkit/marketing/ui';
import type { ReactNode } from 'react';
import { ListingFacets } from '../../src/listing-facets';
import { publishRouteUi } from '../../src/route-ui';
import { SiteFooter, SiteHeader } from '../../src/shell/chrome';

// cms product rails, embedded calculators and catalog listing filters render through boot-bound slots (route-ui.tsx).
publishRouteUi({ ProductRail, PlantCalculator, CompostCalculator, ListingFacets });

// Storefront shell: header and footer read the cms menus (cached, tag nav) with static fallbacks.
export default function ShopLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main">{children}</main>
      <SiteFooter />
      <PlantCalculatorLauncher />
      <TagScripts />
    </>
  );
}
