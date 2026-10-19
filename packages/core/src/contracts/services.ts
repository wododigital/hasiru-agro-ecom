import type { AuthContext } from './auth';
import type { InventoryOps } from './inventory';
import type { NotificationSender } from './notifications';
import type { PlacesReader } from './places';
import type { PricingReader } from './pricing';
import type { ReviewsReader } from './reviews';
import type { ShippingQuoter } from './shipping';

/**
 * Cross-module services resolved through the registry, so an optional module can be absent:
 * `const reviews = await registry.service('reviews')` returns null when no enabled module provides it.
 * A module declares what it provides in `manifest.provides`. One provider per key.
 */
export interface ServiceMap {
  auth: AuthContext;
  pricing: PricingReader;
  inventory: InventoryOps;
  reviews: ReviewsReader;
  places: PlacesReader;
  shipping: ShippingQuoter;
  notifications: NotificationSender;
}
export type ServiceKey = keyof ServiceMap;
