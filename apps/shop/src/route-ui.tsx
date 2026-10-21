import type { ComponentType } from 'react';

/**
 * Storefront components that ports bound at boot render (cms product rails and embedded calculators, catalog
 * listing filters). They carry client islands, so like the extension components in route-registry.ts they must load
 * from the route graph: the shop layout publishes them, and boot binds slots that read them at render time.
 */
export interface RouteUi {
  ProductRail: ComponentType<never>;
  PlantCalculator: ComponentType;
  CompostCalculator: ComponentType;
  ListingFacets: ComponentType<never>;
}

const KEY = Symbol.for('hasiru.shop.routeUi');
type Holder = { [KEY]?: RouteUi };

export const publishRouteUi = (ui: RouteUi): void => void ((globalThis as Holder)[KEY] = ui);

/** A component that renders the published `name`, or nothing outside a storefront route (worker, seed, admin). */
export function routeSlot<P extends object>(name: keyof RouteUi): ComponentType<P> {
  function RouteSlot(props: P) {
    const C = (globalThis as Holder)[KEY]?.[name] as ComponentType<P> | undefined;
    return C ? <C {...props} /> : null;
  }
  RouteSlot.displayName = `RouteSlot(${name})`;
  return RouteSlot;
}
