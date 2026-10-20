import type { Vehicle } from '@ecomkit/shipping/domain';
import { describe, expect, it } from 'vitest';
import { cartWeightKg, meterState, NICELY_PACKED_PCT } from '../src/domain';
import { truckMeterMessages as m } from '../src/messages';

// HANDOFF sample fleet: 750 / 2,500 / 5,000 kg.
const FLEET: Vehicle[] = [
  { id: 's', name: 'Small pickup', capacityKg: 750, localFlatPaise: 150_000, perKmPaise: 2_200 },
  { id: 'm', name: 'Medium truck', capacityKg: 2500, localFlatPaise: 350_000, perKmPaise: 3_500 },
  { id: 'l', name: 'Large truck', capacityKg: 5000, localFlatPaise: 600_000, perKmPaise: 4_800 },
];

describe('cart weight', () => {
  it('sums qty x per-unit weight (sample: large 3 kg, medium 2, small 1, Miyawaki 0.8) in grams', () => {
    expect(cartWeightKg([{ qty: 50, weightKg: 3 }, { qty: 100, weightKg: 2 }, { qty: 200, weightKg: 1 }])).toBe(550);
    expect(cartWeightKg([{ qty: 937, weightKg: 0.8 }])).toBe(749.6);
    expect(cartWeightKg([{ qty: 3, weightKg: 0.1 }])).toBe(0.3);
    expect(cartWeightKg([{ qty: 0, weightKg: 3 }, { qty: 2, weightKg: -1 }])).toBe(0);
  });
});

describe('meter', () => {
  it('is empty for an empty cart', () => {
    expect(meterState(0, FLEET)).toBeNull();
  });

  it('says how much more fits at the same cost, and where the vehicle changes', () => {
    const s = meterState(487.5, FLEET)!;
    expect(s).toMatchObject({ vehicleName: 'Small pickup', fillPct: 65, addKg: 263, addPct: 35, nicelyPacked: false, smallOrder: true, next: { vehicleName: 'Medium truck', aboveKg: 750 } });
    expect(m.title(s.vehicleName, s.fillPct, s.trips)).toBe('Small pickup 65% full');
    expect(m.addMore(s.addKg, s.addPct)).toBe('Add about 263 kg (~35% more) and it ships at the same delivery cost.');
    expect(m.vehicleChange(s.next!.aboveKg, s.next!.vehicleName)).toBe('Above 750 kg the order moves up to a Medium truck.');
  });

  it('reads "nicely packed" from 90% (rounded), not below', () => {
    expect(NICELY_PACKED_PCT).toBe(90);
    expect(meterState(675, FLEET)).toMatchObject({ fillPct: 90, nicelyPacked: true });
    expect(meterState(671, FLEET)).toMatchObject({ fillPct: 89, nicelyPacked: false });
    expect(meterState(750, FLEET)).toMatchObject({ fillPct: 100, addKg: 0, nicelyPacked: true, vehicleName: 'Small pickup' });
  });

  it('moves up a vehicle just over capacity; the largest has no next vehicle', () => {
    expect(meterState(751, FLEET)).toMatchObject({ vehicleName: 'Medium truck', fillPct: 30, smallOrder: false, next: { vehicleName: 'Large truck', aboveKg: 2500 } });
    expect(meterState(4000, FLEET)).toMatchObject({ vehicleName: 'Large truck', next: null });
  });

  it('counts trips beyond the largest vehicle and meters the last trip', () => {
    const s = meterState(12_000, FLEET)!;
    expect(s).toMatchObject({ trips: 3, lastTripKg: 2000, fillPct: 40, addKg: 3000, next: null });
    expect(m.title(s.vehicleName, s.fillPct, s.trips)).toBe('3 trips, Large truck 40% full');
    expect(m.weight(s.lastTripKg, s.capacityKg, s.trips)).toBe('2,000 kg of 5,000 kg on the last trip');
  });
});
