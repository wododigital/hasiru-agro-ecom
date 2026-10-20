import type { Registry } from '@ecomkit/core/manifest';

/**
 * The instrumentation bundle (where boot binds the ports) and the route bundles each compile their own copy of the
 * generated registry. Extension components (pdpSections, cartBlocks, checkoutSections) must load through the route's
 * copy, or their client islands are missing from that route's client manifest. The root layout publishes its copy;
 * the worker and seed:load render nothing and keep their own.
 */
const KEY = Symbol.for('hasiru.shop.routeRegistry');
type Holder = { [KEY]?: Registry };

export const publishRouteRegistry = (r: Registry): void => void ((globalThis as Holder)[KEY] = r);
export const routeRegistry = (): Registry | undefined => (globalThis as Holder)[KEY];
