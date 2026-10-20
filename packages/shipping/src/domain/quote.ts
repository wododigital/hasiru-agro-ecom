import { z } from 'zod';
import type { DeliverySlot, Paise, ShippingAddressInput, ShippingMethodKind, ShippingMethodQuote, VehicleChoice } from '@ecomkit/core/contracts';
import { addDays, istDate, type OpenSlot } from './calendar';
import { localCharge, outstationCharge, type VehiclePlan } from './vehicles';

// Zones (A9) and the pure part of quoteMethods: given the resolved zone, distance, slots and vehicle plan,
// one quote per active method. The server only loads rows and calls this.

export const ZONE_KINDS = ['local', 'outstation', 'enquiry'] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];

export interface Zone {
  id: string;
  slug: string;
  kind: ZoneKind;
  districtSlugs: readonly string[];
  stateCodes: readonly string[];
  position: number;
}

/**
 * The zone for an address: a district listed on a zone beats a state listed on a zone, so "Bengaluru Urban = local"
 * wins over "Karnataka = outstation"; ties go to the lower position. Null = not served (enquiry only).
 */
export function resolveZone(address: ShippingAddressInput | null, zones: readonly Zone[]): Zone | null {
  if (!address) return null;
  const sorted = [...zones].sort((a, b) => a.position - b.position);
  const district = address.districtSlug?.toLowerCase() ?? null;
  const state = address.stateCode?.toUpperCase() ?? null;
  return (district && sorted.find((z) => z.districtSlugs.includes(district))) || (state && sorted.find((z) => z.stateCodes.includes(state))) || null;
}

export const METHOD_KINDS = ['pickup', 'local_slot', 'outstation_distance'] as const;
export type MethodKind = (typeof METHOD_KINDS)[number];

export const methodRuleSchemas = {
  pickup: z.object({ readyInDays: z.int().min(0).max(60).default(1) }),
  local_slot: z.object({ slotsShown: z.int().min(1).max(12).default(4) }),
  outstation_distance: z
    .object({ minDays: z.int().min(0).max(60).default(5), maxDays: z.int().min(0).max(90).default(7) })
    .refine((r) => r.maxDays >= r.minDays, { message: 'maxDays below minDays' }),
} as const;
export type MethodRules = { [K in MethodKind]: z.output<(typeof methodRuleSchemas)[K]> };

export type Method = { [K in MethodKind]: { id: string; kind: K; zoneId: string | null; rules: MethodRules[K] } }[MethodKind];

/** Stored rules JSON to typed rules; anything invalid falls back to the defaults. */
export function parseMethodRules<K extends MethodKind>(kind: K, rules: unknown): MethodRules[K] {
  const schema = methodRuleSchemas[kind] as unknown as z.ZodType<MethodRules[K]>;
  const r = schema.safeParse(rules ?? {});
  return r.success ? r.data : schema.parse({});
}

export const CONTRACT_KIND: Record<MethodKind, ShippingMethodKind> = {
  pickup: 'pickup',
  local_slot: 'local_slot',
  outstation_distance: 'outstation',
};

/** Message keys for unavailable methods (the host renders them). */
export const REASONS = {
  addressNeeded: 'shipping.address_needed',
  outsideLocal: 'shipping.outside_local_zone',
  useLocal: 'shipping.use_local',
  enquiryOnly: 'shipping.enquiry_only',
  distanceUnknown: 'shipping.distance_unknown',
  noSlots: 'shipping.no_slots',
  noVehicle: 'shipping.no_vehicle',
} as const;

export interface QuoteContext {
  now: Date;
  /** Null when there is no address yet (cart preview): local is assumed, outstation waits for an address. */
  zone: Zone | null;
  hasAddress: boolean;
  distanceKm: number | null;
  plan: VehiclePlan | null;
  packingPaise: number;
  /** Open slot dates for this order's weight, earliest first. */
  slots: readonly OpenSlot[];
}

const p = (n: number) => n as Paise;

export function vehicleChoice(plan: VehiclePlan | null): VehicleChoice | null {
  return plan && { vehicleId: plan.vehicle.id, label: plan.vehicle.name, capacityKg: plan.vehicle.capacityKg, trips: plan.trips, fillPct: plan.fillPct };
}

function zoneApplies(method: Method, ctx: QuoteContext, want: ZoneKind): boolean {
  if (!ctx.hasAddress) return want === 'local' && method.zoneId === null;
  return ctx.zone?.kind === want && (method.zoneId === null || method.zoneId === ctx.zone.id);
}

function reasonFor(want: ZoneKind, ctx: QuoteContext): string {
  if (!ctx.hasAddress) return REASONS.addressNeeded;
  if (!ctx.zone || ctx.zone.kind === 'enquiry') return REASONS.enquiryOnly;
  return want === 'local' ? REASONS.outsideLocal : REASONS.useLocal;
}

export function quoteMethod(method: Method, ctx: QuoteContext): ShippingMethodQuote {
  const today = istDate(ctx.now);
  const base = {
    methodId: method.id,
    kind: CONTRACT_KIND[method.kind],
    packingPaise: p(ctx.packingPaise),
    vehicle: null as VehicleChoice | null,
    distanceKm: null as number | null,
    slots: [] as DeliverySlot[],
  };
  const unavailable = (reason: string, extra: Partial<ShippingMethodQuote> = {}): ShippingMethodQuote => ({
    ...base,
    available: false,
    unavailableReason: reason,
    pricePaise: p(0),
    promise: null,
    ...extra,
  });

  switch (method.kind) {
    case 'pickup': {
      const ready = addDays(today, method.rules.readyInDays);
      return { ...base, available: true, unavailableReason: null, pricePaise: p(0), promise: { earliest: ready, latest: ready } };
    }
    case 'local_slot': {
      // A local method attached to a specific zone does not apply before the address is known.
      if (!zoneApplies(method, ctx, 'local')) return unavailable(reasonFor('local', ctx));
      const vehicle = vehicleChoice(ctx.plan);
      const slots = ctx.slots.slice(0, method.rules.slotsShown).map((s) => ({ date: s.date, remaining: s.remainingKg }));
      if (!slots.length) return unavailable(REASONS.noSlots, { vehicle });
      if (!ctx.plan) return unavailable(REASONS.noVehicle, { slots });
      return {
        ...base,
        available: true,
        unavailableReason: null,
        pricePaise: p(localCharge(ctx.plan)),
        vehicle,
        slots,
        promise: { earliest: slots[0]!.date, latest: slots[0]!.date },
      };
    }
    case 'outstation_distance': {
      if (!zoneApplies(method, ctx, 'outstation')) return unavailable(reasonFor('outstation', ctx));
      const vehicle = vehicleChoice(ctx.plan);
      if (ctx.distanceKm === null) return unavailable(REASONS.distanceUnknown, { vehicle });
      const distanceKm = Math.round(ctx.distanceKm);
      if (!ctx.plan) return unavailable(REASONS.noVehicle, { distanceKm });
      return {
        ...base,
        available: true,
        unavailableReason: null,
        pricePaise: p(outstationCharge(ctx.plan, distanceKm)),
        vehicle,
        distanceKm,
        promise: { earliest: addDays(today, method.rules.minDays), latest: addDays(today, method.rules.maxDays) },
      };
    }
  }
}

/** One quote per method, plus an `enquiry_only` marker when the address is outside every served zone. */
export function quoteAll(methods: readonly Method[], ctx: QuoteContext): ShippingMethodQuote[] {
  const quotes = methods.map((m) => quoteMethod(m, ctx));
  if (ctx.hasAddress && (!ctx.zone || ctx.zone.kind === 'enquiry')) {
    quotes.push({
      methodId: 'enquiry',
      kind: 'enquiry_only',
      available: false,
      unavailableReason: REASONS.enquiryOnly,
      pricePaise: p(0),
      packingPaise: p(ctx.packingPaise),
      vehicle: null,
      distanceKm: null,
      slots: [],
      promise: null,
    });
  }
  return quotes;
}
