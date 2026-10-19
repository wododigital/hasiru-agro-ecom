import type { Paise } from './common';

export type ShippingMethodKind = 'pickup' | 'local_slot' | 'outstation' | 'enquiry_only';

export interface ShippingAddressInput {
  pincode: string | null;
  districtSlug: string | null;
  stateCode: string | null;
}

export interface ShippingQuoteInput {
  lines: readonly { variantId: string; qty: number; weightKg: number; packingFeePaise: Paise }[];
  totalWeightKg: number;
  address: ShippingAddressInput | null;
}

export interface VehicleChoice {
  vehicleId: string;
  label: string;
  capacityKg: number;
  trips: number;
  /** Fill of the last trip, 0 to 100. */
  fillPct: number;
}

export interface DeliverySlot {
  /** YYYY-MM-DD in Asia/Kolkata. */
  date: string;
  remaining: number;
}

export interface ShippingMethodQuote {
  methodId: string;
  kind: ShippingMethodKind;
  available: boolean;
  /** Message key when unavailable (e.g. `shipping.outside_zone`). */
  unavailableReason: string | null;
  pricePaise: Paise;
  packingPaise: Paise;
  vehicle: VehicleChoice | null;
  distanceKm: number | null;
  slots: readonly DeliverySlot[];
  promise: { earliest: string; latest: string } | null;
}

/** Service key `shipping`, provided by `@ecomkit/shipping`. */
export interface ShippingQuoter {
  quoteMethods(input: ShippingQuoteInput): Promise<ShippingMethodQuote[]>;
  pickVehicle(weightKg: number): Promise<VehicleChoice | null>;
}
