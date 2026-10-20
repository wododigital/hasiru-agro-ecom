import type { PlacesReader } from '@ecomkit/core/contracts';

// What shipping takes from the host app, bound once at boot (A04-1 pattern): `configureShipping({ places: () =>
// registry.service('places'), resolvePincode })`. Unbound, distances come from overrides only and the delivery
// check needs a district instead of a pincode.

export interface PincodeHit {
  districtSlug: string | null;
  stateCode: string;
}

export interface ShippingRuntimeInput {
  /** Optional places module: road distance from the nursery for outstation quotes. */
  places?: (() => Promise<PlacesReader | null>) | null;
  /** Optional pincode directory (places `findPincode`). Null for an unknown pincode. */
  resolvePincode?: ((pincode: string) => Promise<PincodeHit | null>) | null;
}

interface ShippingRuntime {
  places: () => Promise<PlacesReader | null>;
  resolvePincode: ((pincode: string) => Promise<PincodeHit | null>) | null;
}

const KEY = Symbol.for('ecomkit.shipping.runtime');
type Holder = { [KEY]?: ShippingRuntime };

function build(input: ShippingRuntimeInput): ShippingRuntime {
  return { places: input.places ?? (async () => null), resolvePincode: input.resolvePincode ?? null };
}

/** Replaces any earlier binding. Kept on globalThis so every bundle sees one value. */
export function configureShipping(input: ShippingRuntimeInput): void {
  (globalThis as Holder)[KEY] = build(input);
}

export function shippingRuntime(): ShippingRuntime {
  return ((globalThis as Holder)[KEY] ??= build({}));
}
