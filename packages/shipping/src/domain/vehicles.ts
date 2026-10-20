// Vehicle choice: the smallest active vehicle that carries the whole order; heavier orders take the largest
// vehicle on as many trips as needed. One implementation, used by quotes and by the truck meter.

export interface Vehicle {
  id: string;
  name: string;
  capacityKg: number;
  localFlatPaise: number;
  perKmPaise: number;
}

export interface VehiclePlan {
  vehicle: Vehicle;
  trips: number;
  totalKg: number;
  /** Weight on the last (or only) trip. */
  lastTripKg: number;
  /** Fill of the last trip, 1 to 100 (a non-empty order never shows 0%). */
  fillPct: number;
}

/** Sums of 0.8 kg saplings drift (749.9999999); weights are compared in grams. */
export function roundKg(kg: number): number {
  return Math.round(kg * 1000) / 1000;
}

/** `vehicles` in any order; inactive ones must already be filtered out. Null for an empty order or an empty fleet. */
export function planVehicle(weightKg: number, vehicles: readonly Vehicle[]): VehiclePlan | null {
  const totalKg = roundKg(weightKg);
  if (!(totalKg > 0) || vehicles.length === 0) return null;
  const fleet = [...vehicles].sort((a, b) => a.capacityKg - b.capacityKg);
  // ponytail: smallest single fit, else repeated largest trips (plan section 5 / prototype). A mixed fleet
  // (one large + one small) can be cheaper for orders just over a capacity; add a cost search if the client wants it.
  const fit = fleet.find((v) => v.capacityKg >= totalKg);
  const vehicle = fit ?? fleet[fleet.length - 1]!;
  const trips = fit ? 1 : Math.ceil(totalKg / vehicle.capacityKg);
  const lastTripKg = roundKg(totalKg - (trips - 1) * vehicle.capacityKg);
  const fillPct = Math.min(100, Math.max(1, Math.round((lastTripKg / vehicle.capacityKg) * 100)));
  return { vehicle, trips, totalKg, lastTripKg, fillPct };
}

/** The next larger vehicle, for "over C kg this moves up to X". Null on the largest. */
export function nextVehicle(current: Vehicle, vehicles: readonly Vehicle[]): Vehicle | null {
  return [...vehicles].sort((a, b) => a.capacityKg - b.capacityKg).find((v) => v.capacityKg > current.capacityKg) ?? null;
}

/** Local slot charge: flat rate of the vehicle per trip. */
export function localCharge(plan: VehiclePlan): number {
  return plan.vehicle.localFlatPaise * plan.trips;
}

/** Outstation charge: one-way km x vehicle rate per trip. Km rounds to whole km first. */
export function outstationCharge(plan: VehiclePlan, distanceKm: number): number {
  return Math.round(distanceKm) * plan.vehicle.perKmPaise * plan.trips;
}
