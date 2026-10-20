// Default storefront copy for the truck meter. The host overrides keys with configureTruckMeter({ messages }).
const kg = (n: number) => n.toLocaleString('en-IN');

export const truckMeterMessages = {
  title: (vehicle: string, pct: number, trips: number) => `${trips > 1 ? `${trips} trips, ` : ''}${vehicle} ${pct}% full`,
  weight: (loadKg: number, capacityKg: number, trips: number) => `${kg(loadKg)} kg of ${kg(capacityKg)} kg${trips > 1 ? ' on the last trip' : ''}`,
  meterLabel: 'Delivery vehicle fill',
  nicelyPacked: 'Nicely packed. You are using this trip well.',
  addMore: (addKg: number, addPct: number) => `Add about ${kg(addKg)} kg (~${addPct}% more) and it ships at the same delivery cost.`,
  vehicleChange: (aboveKg: number, vehicle: string) => `Above ${kg(aboveKg)} kg the order moves up to a ${vehicle}.`,
  empty: 'Add items to see how much of a delivery vehicle your order fills.',
  /** Optional footnote, e.g. how weights are estimated. */
  note: null as string | null,
  bar: (pct: number, addKg: number) => `Delivery vehicle ${pct}% full. Add about ${kg(addKg)} kg at no extra delivery cost.`,
  barFull: 'Delivery vehicle nicely packed.',
};
export type TruckMeterMessages = typeof truckMeterMessages;
