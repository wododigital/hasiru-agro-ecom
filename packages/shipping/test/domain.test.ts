import { TEST_NOW } from '@ecomkit/core/testing';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  formatSlotDate,
  istDate,
  localCharge,
  nextVehicle,
  openSlots,
  outstationCharge,
  packingFee,
  parseBlackout,
  planVehicle,
  quoteAll,
  resolveZone,
  type Method,
  type PackingRule,
  type Slot,
  type Vehicle,
  type Zone,
} from '../src/domain';

// HANDOFF sample numbers: 750 / 2,500 / 5,000 kg; local flat Rs 1,500 / 3,500 / 6,000; Rs 22 / 35 / 48 per km.
const FLEET: Vehicle[] = [
  { id: 'large', name: 'Large truck', capacityKg: 5000, localFlatPaise: 600_000, perKmPaise: 4_800 },
  { id: 'small', name: 'Small pickup', capacityKg: 750, localFlatPaise: 150_000, perKmPaise: 2_200 },
  { id: 'medium', name: 'Medium truck', capacityKg: 2500, localFlatPaise: 350_000, perKmPaise: 3_500 },
];
const rs = (paise: number) => paise / 100;

describe('vehicle choice', () => {
  it('picks the smallest vehicle that fits, at exactly its capacity and just over it', () => {
    expect(planVehicle(750, FLEET)).toMatchObject({ vehicle: { id: 'small' }, trips: 1, fillPct: 100 });
    expect(planVehicle(750.001, FLEET)).toMatchObject({ vehicle: { id: 'medium' }, trips: 1, fillPct: 30 });
    expect(planVehicle(2500, FLEET)).toMatchObject({ vehicle: { id: 'medium' }, trips: 1, fillPct: 100 });
    expect(planVehicle(2501, FLEET)).toMatchObject({ vehicle: { id: 'large' }, trips: 1, fillPct: 50 });
    expect(planVehicle(5000, FLEET)).toMatchObject({ vehicle: { id: 'large' }, trips: 1, fillPct: 100 });
  });

  it('runs repeated trips of the largest vehicle above its capacity; fill is the last trip', () => {
    expect(planVehicle(5001, FLEET)).toMatchObject({ vehicle: { id: 'large' }, trips: 2, lastTripKg: 1, fillPct: 1 });
    expect(planVehicle(12_000, FLEET)).toMatchObject({ trips: 3, lastTripKg: 2000, fillPct: 40 });
    expect(planVehicle(15_000, FLEET)).toMatchObject({ trips: 3, lastTripKg: 5000, fillPct: 100 });
  });

  it('never shows 0% for a tiny order, and returns null for an empty order or fleet', () => {
    expect(planVehicle(0.5, FLEET)?.fillPct).toBe(1);
    expect(planVehicle(0, FLEET)).toBeNull();
    expect(planVehicle(-3, FLEET)).toBeNull();
    expect(planVehicle(100, [])).toBeNull();
  });

  it('compares in grams so float sums of sapling weights land on the boundary', () => {
    const sum = Array.from({ length: 7500 }, () => 0.1).reduce((a, b) => a + b, 0);
    expect(sum).not.toBe(750);
    expect(planVehicle(sum, FLEET)).toMatchObject({ vehicle: { id: 'small' }, fillPct: 100 });
    expect(planVehicle(937 * 0.8, FLEET)).toMatchObject({ vehicle: { id: 'small' }, totalKg: 749.6 });
  });

  it('reproduces the sample local charges: flat by vehicle, times trips', () => {
    expect(rs(localCharge(planVehicle(500, FLEET)!))).toBe(1500);
    expect(rs(localCharge(planVehicle(2000, FLEET)!))).toBe(3500);
    expect(rs(localCharge(planVehicle(4000, FLEET)!))).toBe(6000);
    expect(rs(localCharge(planVehicle(12_000, FLEET)!))).toBe(18_000);
  });

  it('reproduces the sample outstation charges for Mysuru at 150 km', () => {
    expect(rs(outstationCharge(planVehicle(500, FLEET)!, 150))).toBe(3300);
    expect(rs(outstationCharge(planVehicle(2000, FLEET)!, 150))).toBe(5250);
    expect(rs(outstationCharge(planVehicle(4000, FLEET)!, 150))).toBe(7200);
    expect(rs(outstationCharge(planVehicle(6000, FLEET)!, 150))).toBe(14_400);
    expect(rs(outstationCharge(planVehicle(500, FLEET)!, 149.6))).toBe(3300);
  });

  it('names the next larger vehicle, none above the largest', () => {
    expect(nextVehicle(FLEET[1]!, FLEET)?.id).toBe('medium');
    expect(nextVehicle(FLEET[0]!, FLEET)).toBeNull();
  });
});

describe('packing fee', () => {
  const lines = [
    { variantId: 'v-s', productId: 'p-s', qty: 10, packingFeePaise: 500, sizeClass: 'S' },
    { variantId: 'v-m', productId: 'p-m', qty: 4, packingFeePaise: 1000, sizeClass: 'M' },
    { variantId: 'v-l', productId: 'p-l', qty: 2, packingFeePaise: 1500, sizeClass: 'L' },
    { variantId: 'v-input', productId: 'p-input', qty: 3, packingFeePaise: 0 },
  ];

  it('uses each line own fee with no rules (sample: Rs 5 small, 10 medium, 15 large, inputs free)', () => {
    expect(packingFee(lines, []).totalPaise).toBe(10 * 500 + 4 * 1000 + 2 * 1500);
  });

  it('first matching line rule by position sets the unit fee; order rules add once', () => {
    const rules: PackingRule[] = [
      { id: 'band', scope: 'qty_band', match: { minQty: 10, maxQty: null }, feePaise: 300, position: 20 },
      { id: 'large', scope: 'size_class', match: { sizeClass: 'L' }, feePaise: 2000, position: 10 },
      { id: 'one', scope: 'product', match: { productIds: [], variantIds: ['v-m'] }, feePaise: 0, position: 30 },
      { id: 'flat', scope: 'order', match: {}, feePaise: 5000, position: 40 },
    ];
    const out = packingFee(lines, rules);
    expect(out.lines.map((l) => [l.variantId, l.unitPaise, l.ruleId])).toEqual([
      ['v-s', 300, 'band'],
      ['v-m', 0, 'one'],
      ['v-l', 2000, 'large'],
      ['v-input', 0, null],
    ]);
    expect(out.totalPaise).toBe(10 * 300 + 0 + 2 * 2000 + 5000);
    expect(packingFee([], rules).totalPaise).toBe(0);
  });

  it('qty band upper bound is inclusive', () => {
    const rules: PackingRule[] = [{ id: 'b', scope: 'qty_band', match: { minQty: 1, maxQty: 9 }, feePaise: 100, position: 0 }];
    expect(packingFee([{ variantId: 'a', qty: 9, packingFeePaise: 500 }], rules).totalPaise).toBe(900);
    expect(packingFee([{ variantId: 'a', qty: 10, packingFeePaise: 500 }], rules).totalPaise).toBe(5000);
  });
});

describe('slot calendar (IST)', () => {
  const saturday: Slot[] = [{ id: 'sat', weekday: 6, cutoffHours: 24, capacityKg: 15_000 }];
  const q = (now: Date, extra: Partial<Parameters<typeof openSlots>[1]> = {}) =>
    openSlots(saturday, { now, count: 4, weightKg: 100, bookedKg: new Map(), blackout: new Set(), ...extra }).map((s) => s.date);

  it('IST dates roll over at 18:30 UTC', () => {
    expect(istDate(new Date('2026-10-20T18:29:59.999Z'))).toBe('2026-10-20');
    expect(istDate(new Date('2026-10-20T18:30:00Z'))).toBe('2026-10-21');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(formatSlotDate('2026-10-24')).toBe('Saturday 24 Oct');
  });

  it('lists the next four Saturdays from the test clock (Tuesday 20 Oct, 10:00 IST)', () => {
    expect(q(TEST_NOW)).toEqual(['2026-10-24', '2026-10-31', '2026-11-07', '2026-11-14']);
  });

  it('closes a Saturday exactly 24 h before 00:00 IST Saturday, i.e. at Friday 00:00 IST', () => {
    expect(q(new Date('2026-10-22T23:59:59.999+05:30'))[0]).toBe('2026-10-24');
    expect(q(new Date('2026-10-23T00:00:00+05:30'))[0]).toBe('2026-10-31');
    // The same instant in UTC (Thursday 18:30): a UTC calendar would wrongly keep the slot open.
    expect(q(new Date('2026-10-22T18:30:00Z'))[0]).toBe('2026-10-31');
  });

  it('skips a day without room for the order; exact remaining room still fits', () => {
    const bookedKg = new Map([['2026-10-24', 14_500]]);
    expect(q(TEST_NOW, { bookedKg, weightKg: 501 })[0]).toBe('2026-10-31');
    expect(q(TEST_NOW, { bookedKg, weightKg: 500 })[0]).toBe('2026-10-24');
    expect(openSlots([{ id: 'x', weekday: 6, cutoffHours: 24, capacityKg: null }], { now: TEST_NOW, count: 1, weightKg: 99_999, bookedKg, blackout: new Set() })[0]).toMatchObject({
      date: '2026-10-24',
      remainingKg: Number.MAX_SAFE_INTEGER,
    });
  });

  it('skips blackout dates and ignores malformed entries', () => {
    expect(q(TEST_NOW, { blackout: parseBlackout('2026-10-24, nonsense 2026-11-07') })).toEqual(['2026-10-31', '2026-11-14', '2026-11-21', '2026-11-28']);
  });
});

describe('zones (A9) and quotes', () => {
  const zones: Zone[] = [
    { id: 'z-out', slug: 'outstation', kind: 'outstation', districtSlugs: [], stateCodes: ['KA', 'TN', 'KL', 'AP', 'TG', 'GA'], position: 0 },
    { id: 'z-local', slug: 'local', kind: 'local', districtSlugs: ['bengaluru-urban', 'bengaluru-rural'], stateCodes: [], position: 10 },
  ];
  const methods: Method[] = [
    { id: 'pickup', kind: 'pickup', zoneId: null, rules: { readyInDays: 1 } },
    { id: 'local', kind: 'local_slot', zoneId: 'z-local', rules: { slotsShown: 2 } },
    { id: 'out', kind: 'outstation_distance', zoneId: 'z-out', rules: { minDays: 5, maxDays: 7 } },
  ];
  const slots = [
    { date: '2026-10-24', slotId: 's', remainingKg: 9000 },
    { date: '2026-10-31', slotId: 's', remainingKg: 15_000 },
    { date: '2026-11-07', slotId: 's', remainingKg: 15_000 },
  ];

  it('a district on a zone beats a state on another, whatever the positions', () => {
    expect(resolveZone({ pincode: null, districtSlug: 'bengaluru-urban', stateCode: 'KA' }, zones)?.slug).toBe('local');
    expect(resolveZone({ pincode: null, districtSlug: 'mysuru', stateCode: 'ka' }, zones)?.slug).toBe('outstation');
    expect(resolveZone({ pincode: null, districtSlug: 'pune', stateCode: 'MH' }, zones)).toBeNull();
    expect(resolveZone(null, zones)).toBeNull();
  });

  it('local address: pickup + local slot priced by vehicle with dates; outstation points to local', () => {
    const quotes = quoteAll(methods, { now: TEST_NOW, zone: zones[1]!, hasAddress: true, distanceKm: null, plan: planVehicle(2000, FLEET), packingPaise: 4000, slots });
    expect(quotes.map((q) => [q.methodId, q.available, q.unavailableReason, q.pricePaise])).toEqual([
      ['pickup', true, null, 0],
      ['local', true, null, 350_000],
      ['out', false, 'shipping.use_local', 0],
    ]);
    expect(quotes[0]!.promise).toEqual({ earliest: '2026-10-21', latest: '2026-10-21' });
    expect(quotes[1]).toMatchObject({ vehicle: { label: 'Medium truck', trips: 1, fillPct: 80 }, slots: [{ date: '2026-10-24', remaining: 9000 }, { date: '2026-10-31' }], promise: { earliest: '2026-10-24' }, packingPaise: 4000 });
  });

  it('outstation address: km x rate x trips with a 5 to 7 day window', () => {
    const quotes = quoteAll(methods, { now: TEST_NOW, zone: zones[0]!, hasAddress: true, distanceKm: 150, plan: planVehicle(2000, FLEET), packingPaise: 0, slots });
    expect(quotes[1]).toMatchObject({ available: false, unavailableReason: 'shipping.outside_local_zone' });
    expect(quotes[2]).toMatchObject({ available: true, pricePaise: 525_000, distanceKm: 150, promise: { earliest: '2026-10-25', latest: '2026-10-27' } });
    const unknown = quoteAll(methods, { now: TEST_NOW, zone: zones[0]!, hasAddress: true, distanceKm: null, plan: planVehicle(2000, FLEET), packingPaise: 0, slots });
    expect(unknown[2]).toMatchObject({ available: false, unavailableReason: 'shipping.distance_unknown' });
  });

  it('no address yet: zone-bound methods wait for the address; outside every zone adds an enquiry-only marker', () => {
    const anyLocal: Method[] = [...methods, { id: 'any-local', kind: 'local_slot', zoneId: null, rules: { slotsShown: 4 } }];
    const preview = quoteAll(anyLocal, { now: TEST_NOW, zone: null, hasAddress: false, distanceKm: null, plan: planVehicle(10, FLEET), packingPaise: 0, slots });
    expect(preview.map((q) => [q.methodId, q.available, q.unavailableReason])).toEqual([
      ['pickup', true, null],
      ['local', false, 'shipping.address_needed'],
      ['out', false, 'shipping.address_needed'],
      ['any-local', true, null],
    ]);
    const far = quoteAll(methods, { now: TEST_NOW, zone: null, hasAddress: true, distanceKm: null, plan: planVehicle(10, FLEET), packingPaise: 0, slots });
    expect(far.map((q) => [q.kind, q.available, q.unavailableReason])).toEqual([
      ['pickup', true, null],
      ['local_slot', false, 'shipping.enquiry_only'],
      ['outstation', false, 'shipping.enquiry_only'],
      ['enquiry_only', false, 'shipping.enquiry_only'],
    ]);
  });

  it('local without open days or without vehicles says why', () => {
    const z = zones[1]!;
    expect(quoteAll(methods, { now: TEST_NOW, zone: z, hasAddress: true, distanceKm: null, plan: planVehicle(10, FLEET), packingPaise: 0, slots: [] })[1]).toMatchObject({
      available: false,
      unavailableReason: 'shipping.no_slots',
    });
    expect(quoteAll(methods, { now: TEST_NOW, zone: z, hasAddress: true, distanceKm: null, plan: null, packingPaise: 0, slots })[1]).toMatchObject({
      available: false,
      unavailableReason: 'shipping.no_vehicle',
    });
  });
});
