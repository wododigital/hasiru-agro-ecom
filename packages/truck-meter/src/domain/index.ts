// Truck meter maths over shipping's vehicle choice (one implementation of "which vehicle, how many trips").
import { nextVehicle, planVehicle, roundKg, type Vehicle } from '@ecomkit/shipping/domain';

/** Fill at or above this reads as "nicely packed". */
export const NICELY_PACKED_PCT = 90;

export interface MeterLine {
  qty: number;
  /** Per unit (cart-block contract: origin.weightKg when set, else the variant weight). */
  weightKg: number;
}

export interface MeterState {
  vehicleName: string;
  capacityKg: number;
  trips: number;
  totalKg: number;
  lastTripKg: number;
  /** 1 to 100. */
  fillPct: number;
  nicelyPacked: boolean;
  /** Room left on the last trip at the same delivery cost. */
  addKg: number;
  addPct: number;
  /** Single-trip orders: the vehicle the order moves up to past this vehicle's capacity. */
  next: { vehicleName: string; aboveKg: number } | null;
  /** One trip on the smallest vehicle: the small-order bar case. */
  smallOrder: boolean;
}

export function cartWeightKg(lines: readonly MeterLine[]): number {
  return roundKg(lines.reduce((sum, l) => sum + (l.qty > 0 && l.weightKg > 0 ? l.qty * l.weightKg : 0), 0));
}

export function meterState(weightKg: number, vehicles: readonly Vehicle[]): MeterState | null {
  const plan = planVehicle(weightKg, vehicles);
  if (!plan) return null;
  const { vehicle, trips, totalKg, lastTripKg, fillPct } = plan;
  const next = trips === 1 ? nextVehicle(vehicle, vehicles) : null;
  const smallest = Math.min(...vehicles.map((v) => v.capacityKg));
  return {
    vehicleName: vehicle.name,
    capacityKg: vehicle.capacityKg,
    trips,
    totalKg,
    lastTripKg,
    fillPct,
    nicelyPacked: fillPct >= NICELY_PACKED_PCT,
    addKg: Math.max(0, Math.round(vehicle.capacityKg - lastTripKg)),
    addPct: 100 - fillPct,
    next: next && { vehicleName: next.name, aboveKg: vehicle.capacityKg },
    smallOrder: trips === 1 && vehicle.capacityKg === smallest,
  };
}
