import { and, gte, isNull, sql } from 'drizzle-orm';
import type { ShippingMethodQuote, ShippingQuoteInput, ShippingQuoter, VehicleChoice } from '@ecomkit/core/contracts';
import { db, type DbOrTx } from '@ecomkit/core/db';
import { getSettings } from '@ecomkit/core/settings';
import {
  istDate,
  openSlots,
  packingFee as packingBreakdown,
  parseBlackout,
  planVehicle,
  quoteAll,
  resolveZone,
  roundKg,
  vehicleChoice,
  type OpenSlot,
  type PackingLine,
  type Slot,
  type Vehicle,
  type VehiclePlan,
} from '../domain';
import { shippingSlotBooking } from '../schema';
import { shippingSettings } from '../settings';
import { distanceOverride, loadConfig } from './config';
import { shippingRuntime } from './runtime';

/** kg booked per date from `from` on (active bookings only). */
export async function bookedKgFrom(from: string, dbOrTx: DbOrTx = db): Promise<Map<string, number>> {
  const rows = await dbOrTx
    .select({ date: shippingSlotBooking.slotDate, kg: sql<string>`sum(${shippingSlotBooking.weightKg})` })
    .from(shippingSlotBooking)
    .where(and(gte(shippingSlotBooking.slotDate, from), isNull(shippingSlotBooking.cancelledAt)))
    .groupBy(shippingSlotBooking.slotDate);
  return new Map(rows.map((r) => [r.date, Number(r.kg)]));
}

export interface SlotOptions {
  weightKg?: number;
  now?: Date;
}

/** The next `n` local delivery dates that are before their cutoff, not blacked out and have room for `weightKg`. */
export async function nextSlots(n: number, options: SlotOptions = {}): Promise<OpenSlot[]> {
  const now = options.now ?? new Date();
  const [{ slots }, settings, booked] = await Promise.all([loadConfig(), getSettings(shippingSettings), bookedKgFrom(istDate(now))]);
  return slotsFor(slots, n, roundKg(options.weightKg ?? 0), now, booked, settings.blackout_dates);
}

function slotsFor(slots: readonly Slot[], count: number, weightKg: number, now: Date, bookedKg: Map<string, number>, blackout: string): OpenSlot[] {
  return openSlots(slots, { now, count, weightKg, bookedKg, blackout: parseBlackout(blackout) });
}

export async function listVehicles(): Promise<Vehicle[]> {
  return (await loadConfig()).vehicles;
}

/** Vehicle plan for a weight (smallest fit, else trips of the largest). */
export async function planFor(weightKg: number): Promise<VehiclePlan | null> {
  return planVehicle(weightKg, await listVehicles());
}

export async function pickVehicle(weightKg: number): Promise<VehicleChoice | null> {
  return vehicleChoice(await planFor(weightKg));
}

/** Packing fee for cart lines under the stored rules. */
export async function packingFee(lines: readonly PackingLine[]): Promise<number> {
  return packingBreakdown(lines, (await loadConfig()).packingRules).totalPaise;
}

async function distanceFor(districtSlug: string | null): Promise<number | null> {
  if (!districtSlug) return null;
  const pinned = await distanceOverride(districtSlug);
  if (pinned !== null) return pinned;
  const places = await shippingRuntime().places();
  return (await places?.getDistrict(districtSlug))?.distanceKm ?? null;
}

/**
 * Every active method for this cart and address, available or not (with a reason key), cheapest data first.
 * Lines may carry `productId` and `sizeClass` beyond the contract so product and size-class packing rules can match.
 */
export async function quoteMethods(input: ShippingQuoteInput & { lines: readonly PackingLine[] }, options: { now?: Date } = {}): Promise<ShippingMethodQuote[]> {
  const now = options.now ?? new Date();
  const weightKg = roundKg(input.totalWeightKg);
  const [cfg, settings, booked] = await Promise.all([loadConfig(), getSettings(shippingSettings), bookedKgFrom(istDate(now))]);
  const zone = resolveZone(input.address, cfg.zones);
  const distanceKm = zone?.kind === 'outstation' ? await distanceFor(input.address?.districtSlug ?? null) : null;
  const shown = Math.max(1, ...cfg.methods.map((m) => (m.kind === 'local_slot' ? m.rules.slotsShown : 1)));
  return quoteAll(cfg.methods, {
    now,
    zone,
    hasAddress: input.address !== null,
    distanceKm,
    plan: planVehicle(weightKg, cfg.vehicles),
    packingPaise: packingBreakdown(input.lines, cfg.packingRules).totalPaise,
    slots: slotsFor(cfg.slots, shown, weightKg, now, booked, settings.blackout_dates),
  });
}

/** The `shipping` service (shipping-method contract). */
export const shippingQuoter: ShippingQuoter = {
  quoteMethods: (input) => quoteMethods(input),
  pickVehicle: (weightKg) => pickVehicle(weightKg),
};
