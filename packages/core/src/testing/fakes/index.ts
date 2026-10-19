// In-memory fakes that implement the frozen contracts, so pages and tests can run before the real modules exist.
// Values are test fixtures, not business data.
import type {
  Availability,
  FitLevel,
  InventoryOps,
  NotificationChannel,
  OutboundMessage,
  Paise,
  PlacesReader,
  PriceQuote,
  PricingReader,
  ReviewsReader,
  ShippingQuoter,
  StockInfo,
  VehicleChoice,
} from '../../contracts';
import { RATING_MIN_REVIEWS } from '../../contracts';

const paise = (n: number) => n as Paise;
const productOf = (variantId: string) => `product-${variantId}`;

// ---- pricing: list price plus one bulk tier ---------------------------------
export interface FakePricingOptions {
  listPaise?: number;
  tier?: { minQty: number; unitPaise: number };
  compareAtPaise?: number | null;
  gstRatePct?: number;
}

export function fakePricing(options: FakePricingOptions = {}): PricingReader {
  const list = options.listPaise ?? 49_000;
  const tier = options.tier ?? { minQty: 50, unitPaise: 35_500 };
  const quote = (variantId: string, qty: number): PriceQuote => {
    const inTier = qty >= tier.minQty;
    const unit = inTier ? tier.unitPaise : list;
    return {
      productId: productOf(variantId),
      variantId,
      qty,
      listUnitPaise: paise(list),
      compareAtPaise: options.compareAtPaise == null ? null : paise(options.compareAtPaise),
      unitPaise: paise(unit),
      tier: inTier ? { minQty: tier.minQty, unitPaise: paise(tier.unitPaise) } : null,
      nextTier: inTier ? null : { minQty: tier.minQty, unitPaise: paise(tier.unitPaise), qtyToGo: tier.minQty - qty },
      gstRatePct: options.gstRatePct ?? 0,
      lineTotalPaise: paise(unit * qty),
    };
  };
  return {
    getPrice: async (variantId, qty) => quote(variantId, qty),
    getPrices: async (items) => Object.fromEntries(items.map((i) => [i.variantId, quote(i.variantId, i.qty)])),
  };
}

// ---- inventory: in stock / out / preorder by variant ------------------------
export function fakeInventory(states: Record<string, Availability> = {}, fallback: Availability = 'in_stock'): InventoryOps & {
  readonly reservations: ReadonlyMap<string, { variantId: string; qty: number }[]>;
} {
  const reserved = new Map<string, number>();
  const reservations = new Map<string, { variantId: string; qty: number }[]>();
  const onHandFor = (a: Availability) => (a === 'in_stock' ? 100 : 0);
  const stock = (variantId: string): StockInfo => {
    const availability = states[variantId] ?? fallback;
    const onHand = onHandFor(availability);
    const held = reserved.get(variantId) ?? 0;
    const available = Math.max(0, onHand - held);
    return {
      variantId,
      available,
      onHand,
      reserved: held,
      availability: availability === 'in_stock' && available === 0 ? 'out_of_stock' : availability,
      readyInDays: availability === 'preorder' ? 30 : null,
      lowStock: availability === 'in_stock' && available <= 10,
    };
  };
  let seq = 0;
  return {
    reservations,
    getStock: async (variantId) => stock(variantId),
    getStocks: async (ids) => Object.fromEntries(ids.map((id) => [id, stock(id)])),
    reserve: async (lines, { ttlSec }) => {
      const shortages = lines
        .map((l) => ({ l, s: stock(l.variantId) }))
        .filter(({ l, s }) => s.availability !== 'preorder' && s.available < l.qty)
        .map(({ l, s }) => ({ variantId: l.variantId, requested: l.qty, available: s.available }));
      if (shortages.length) return { ok: false, shortages };
      const reservationId = `res-${++seq}`;
      reservations.set(reservationId, lines.map((l) => ({ ...l })));
      for (const l of lines) reserved.set(l.variantId, (reserved.get(l.variantId) ?? 0) + l.qty);
      return { ok: true, reservation: { reservationId, expiresAt: new Date(Date.now() + ttlSec * 1000), lines } };
    },
    commit: async (reservationId) => {
      reservations.delete(reservationId);
    },
    release: async (reservationId) => {
      for (const l of reservations.get(reservationId) ?? []) reserved.set(l.variantId, (reserved.get(l.variantId) ?? 0) - l.qty);
      reservations.delete(reservationId);
    },
  };
}

// ---- places: climate fit by district slug ------------------------------------
const FAKE_DISTRICTS = [
  { slug: 'bengaluru-urban', name: 'Bengaluru Urban', distanceKm: 0, fit: 'good' },
  { slug: 'mysuru', name: 'Mysuru', distanceKm: 150, fit: 'ok' },
  { slug: 'ballari', name: 'Ballari', distanceKm: 310, fit: 'not_recommended' },
] as const;

export function fakeFit(overrides: Record<string, FitLevel> = {}): PlacesReader {
  const ref = (d: (typeof FAKE_DISTRICTS)[number]) => ({
    slug: d.slug,
    name: d.name,
    stateCode: 'KA',
    stateName: 'Karnataka',
    gstStateCode: '29',
    distanceKm: d.distanceKm,
    lat: null,
    lng: null,
  });
  return {
    suggest: async (query, limit = 6) =>
      FAKE_DISTRICTS.filter((d) => d.name.toLowerCase().includes(query.trim().toLowerCase()))
        .slice(0, limit)
        .map((d) => ({ kind: 'district' as const, label: d.name, district: ref(d) })),
    getDistrict: async (slug) => {
      const d = FAKE_DISTRICTS.find((x) => x.slug === slug);
      return d ? ref(d) : null;
    },
    fit: async (districtSlug) => {
      const level = overrides[districtSlug] ?? FAKE_DISTRICTS.find((d) => d.slug === districtSlug)?.fit ?? 'ok';
      return { level, reasons: level === 'good' ? [] : [`fit.${level}`] };
    },
  };
}

// ---- reviews: 0 or 5 approved ------------------------------------------------
export function fakeReviews(options: { approved: 0 | 5 } = { approved: 0 }): ReviewsReader {
  const aggregate = (productId: string) => ({
    productId,
    count: options.approved,
    average: options.approved ? 4.6 : null,
    showRating: options.approved >= RATING_MIN_REVIEWS,
  });
  return {
    aggregate: async (productId) => aggregate(productId),
    aggregates: async (ids) => Object.fromEntries(ids.map((id) => [id, aggregate(id)])),
  };
}

// ---- shipping: pickup, local slot, outstation --------------------------------
const FAKE_VEHICLES = [
  { vehicleId: 'small', label: 'Small pickup', capacityKg: 750, localPaise: 150_000, perKmPaise: 2_200 },
  { vehicleId: 'medium', label: 'Medium truck', capacityKg: 2_500, localPaise: 350_000, perKmPaise: 3_500 },
  { vehicleId: 'large', label: 'Large truck', capacityKg: 5_000, localPaise: 600_000, perKmPaise: 4_800 },
] as const;

export function fakeShippingQuote(): ShippingQuoter {
  const pick = (weightKg: number): (VehicleChoice & { localPaise: number; perKmPaise: number }) | null => {
    if (weightKg <= 0) return null;
    const fit = FAKE_VEHICLES.find((v) => v.capacityKg >= weightKg);
    const v = fit ?? FAKE_VEHICLES[FAKE_VEHICLES.length - 1]!;
    const trips = fit ? 1 : Math.ceil(weightKg / v.capacityKg);
    const last = weightKg - (trips - 1) * v.capacityKg;
    return { ...v, trips, fillPct: Math.round((last / v.capacityKg) * 100) };
  };
  return {
    pickVehicle: async (weightKg) => {
      const v = pick(weightKg);
      return v && { vehicleId: v.vehicleId, label: v.label, capacityKg: v.capacityKg, trips: v.trips, fillPct: v.fillPct };
    },
    quoteMethods: async ({ lines, totalWeightKg, address }) => {
      const v = pick(totalWeightKg);
      const vehicle = v && { vehicleId: v.vehicleId, label: v.label, capacityKg: v.capacityKg, trips: v.trips, fillPct: v.fillPct };
      const packingPaise = paise(lines.reduce((s, l) => s + l.packingFeePaise * l.qty, 0));
      const local = !address?.districtSlug || address.districtSlug === 'bengaluru-urban';
      const distanceKm = local ? null : 150;
      return [
        { methodId: 'pickup', kind: 'pickup', available: true, unavailableReason: null, pricePaise: paise(0), packingPaise, vehicle: null, distanceKm: null, slots: [], promise: null },
        {
          methodId: 'local',
          kind: 'local_slot',
          available: local,
          unavailableReason: local ? null : 'shipping.outside_local_zone',
          pricePaise: paise(v ? v.localPaise * v.trips : 0),
          packingPaise,
          vehicle,
          distanceKm: null,
          slots: [{ date: '2026-10-24', remaining: 5 }],
          promise: { earliest: '2026-10-24', latest: '2026-10-24' },
        },
        {
          methodId: 'outstation',
          kind: 'outstation',
          available: !local,
          unavailableReason: local ? 'shipping.use_local' : null,
          pricePaise: paise(v && distanceKm ? v.perKmPaise * distanceKm * v.trips : 0),
          packingPaise,
          vehicle,
          distanceKm,
          slots: [],
          promise: { earliest: '2026-10-27', latest: '2026-10-30' },
        },
      ];
    },
  };
}

// ---- notifications: log adapter that records sends ---------------------------
export function fakeNotificationChannel(id: NotificationChannel['id'] = 'log'): NotificationChannel & { readonly sent: OutboundMessage[] } {
  const sent: OutboundMessage[] = [];
  return {
    id,
    adapter: 'fake',
    sent,
    send: async (message) => {
      sent.push(message);
      return { status: 'sent', providerMessageId: `fake-${sent.length}`, error: null };
    },
  };
}
