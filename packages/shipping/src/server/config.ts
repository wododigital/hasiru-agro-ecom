import { asc, eq } from 'drizzle-orm';
import { db, type DbOrTx } from '@ecomkit/core/db';
import { parseMethodRules, parsePackingMatch, type Method, type PackingRule, type PackingScope, type Slot, type Vehicle, type Zone } from '../domain';
import { shippingDistanceOverride, shippingMethod, shippingPackingRule, shippingSlot, shippingVehicle, shippingZone } from '../schema';

export interface ShippingConfig {
  zones: Zone[];
  methods: Method[];
  vehicles: Vehicle[];
  slots: Slot[];
  packingRules: PackingRule[];
}

/** Active configuration rows. ponytail: five small indexed reads per quote, no cache; add a TTL cache if quotes show up in traces. */
export async function loadConfig(dbOrTx: DbOrTx = db): Promise<ShippingConfig> {
  const [zones, methods, vehicles, slots, rules] = await Promise.all([
    dbOrTx.select().from(shippingZone).orderBy(asc(shippingZone.position)),
    dbOrTx.select().from(shippingMethod).where(eq(shippingMethod.isActive, true)).orderBy(asc(shippingMethod.position), asc(shippingMethod.createdAt)),
    dbOrTx.select().from(shippingVehicle).where(eq(shippingVehicle.isActive, true)).orderBy(asc(shippingVehicle.capacityKg)),
    dbOrTx.select().from(shippingSlot).where(eq(shippingSlot.isActive, true)).orderBy(asc(shippingSlot.weekday)),
    dbOrTx.select().from(shippingPackingRule).orderBy(asc(shippingPackingRule.position)),
  ]);
  return {
    zones: zones.map((z) => ({ id: z.id, slug: z.slug, kind: z.kind, districtSlugs: z.districtSlugs, stateCodes: z.stateCodes, position: z.position })),
    methods: methods.map((m) => ({ id: m.id, kind: m.kind, zoneId: m.zoneId, rules: parseMethodRules(m.kind, m.rules) }) as Method),
    vehicles: vehicles.map((v) => ({ id: v.id, name: v.name, capacityKg: v.capacityKg, localFlatPaise: v.localFlatPaise, perKmPaise: v.perKmPaise })),
    slots: slots.map((s) => ({ id: s.id, weekday: s.weekday, cutoffHours: s.cutoffHours, capacityKg: s.capacityKg })),
    packingRules: rules.flatMap((r) => {
      const match = parsePackingMatch(r.scope as PackingScope, r.match);
      return match ? [{ id: r.id, scope: r.scope, match, feePaise: r.feePaise, position: r.position } as PackingRule] : [];
    }),
  };
}

export async function distanceOverride(districtSlug: string, dbOrTx: DbOrTx = db): Promise<number | null> {
  const [row] = await dbOrTx.select({ km: shippingDistanceOverride.km }).from(shippingDistanceOverride).where(eq(shippingDistanceOverride.districtSlug, districtSlug)).limit(1);
  return row ? row.km : null;
}
