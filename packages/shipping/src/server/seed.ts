// Seed hook `shipping.setup`: data/seed/shipping.json -> zones, methods, vehicles, slots, packing rules, distances.
// Each table is seeded only while it is empty: after the first load the admin owns the rows, and a re-run changes nothing.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { count } from 'drizzle-orm';
import type { SeedContext, SeedResult } from '@ecomkit/core/contracts';
import { withTx } from '@ecomkit/core/db';
import { newId } from '@ecomkit/core/ids';
import { paise } from '@ecomkit/core/money';
import { parseMethodRules, parsePackingMatch, shippingSeedSchema, type ShippingSeed } from '../domain';
import { shippingDistanceOverride, shippingMethod, shippingPackingRule, shippingSlot, shippingVehicle, shippingZone } from '../schema';

type SeededTable =
  | typeof shippingZone
  | typeof shippingMethod
  | typeof shippingVehicle
  | typeof shippingSlot
  | typeof shippingPackingRule
  | typeof shippingDistanceOverride;

export async function readShippingSeed(seedDir: string): Promise<ShippingSeed | null> {
  let raw: string;
  try {
    raw = await readFile(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ seedDir, 'shipping.json'), 'utf8');
  } catch {
    return null;
  }
  return shippingSeedSchema.parse(JSON.parse(raw));
}

export async function loadShippingSeed(seed: ShippingSeed, options: { dryRun?: boolean } = {}): Promise<SeedResult> {
  const r = seed.records;
  const result = { inserted: 0, updated: 0, skipped: 0, notes: [] as string[] };
  for (const m of r.methods) {
    if (m.zone_slug && !r.zones.some((z) => z.slug === m.zone_slug)) throw new Error(`shipping.json: method "${m.name}" names unknown zone "${m.zone_slug}"`);
  }
  for (const rule of r.packing_rules) {
    if (!parsePackingMatch(rule.scope, rule.match)) throw new Error(`shipping.json: packing rule match does not fit scope "${rule.scope}"`);
  }

  await withTx(async (tx) => {
    const section = async <T>(name: string, table: SeededTable, rows: readonly T[], insert: (rows: readonly T[]) => Promise<unknown>) => {
      if (!rows.length) return;
      const [existing] = await tx.select({ n: count() }).from(table);
      if ((existing?.n ?? 0) > 0) {
        result.skipped += rows.length;
        result.notes.push(`${name}: table already has rows, left as edited`);
        return;
      }
      if (!options.dryRun) await insert(rows);
      result.inserted += rows.length;
    };

    // Zones first: methods point at them. Existing zones are looked up by slug for methods seeded later.
    const zoneIds = new Map<string, string>((await tx.select({ id: shippingZone.id, slug: shippingZone.slug }).from(shippingZone)).map((z) => [z.slug, z.id]));
    await section('zones', shippingZone, r.zones, async (rows) => {
      const values = rows.map((z, i) => ({ id: newId(), slug: z.slug, name: z.name, kind: z.kind, districtSlugs: z.district_slugs, stateCodes: z.state_codes, position: i * 10 }));
      for (const v of values) zoneIds.set(v.slug, v.id);
      await tx.insert(shippingZone).values(values);
    });
    await section('methods', shippingMethod, r.methods, (rows) =>
      tx.insert(shippingMethod).values(
        rows.map((m, i) => {
          const zoneId = m.zone_slug ? zoneIds.get(m.zone_slug) : null;
          if (zoneId === undefined) throw new Error(`shipping.json: zone "${m.zone_slug}" is not in the database`);
          return { id: newId(), name: m.name, kind: m.kind, zoneId, rules: parseMethodRules(m.kind, m.rules), position: i * 10 };
        }),
      ),
    );
    await section('vehicles', shippingVehicle, r.vehicles, (rows) =>
      tx.insert(shippingVehicle).values(
        rows.map((v, i) => ({ id: newId(), name: v.name, capacityKg: v.capacity_kg, localFlatPaise: paise(v.local_flat_rs), perKmPaise: paise(v.per_km_rs), position: i * 10 })),
      ),
    );
    await section('slots', shippingSlot, r.slots, (rows) =>
      tx.insert(shippingSlot).values(rows.map((s) => ({ id: newId(), weekday: s.weekday, cutoffHours: s.cutoff_hours, capacityKg: s.capacity_kg }))),
    );
    await section('packing rules', shippingPackingRule, r.packing_rules, (rows) =>
      tx.insert(shippingPackingRule).values(rows.map((p, i) => ({ id: newId(), scope: p.scope, match: parsePackingMatch(p.scope, p.match)!, feePaise: paise(p.fee_rs), position: i * 10 }))),
    );
    await section('distance overrides', shippingDistanceOverride, r.distance_overrides, (rows) =>
      tx.insert(shippingDistanceOverride).values(rows.map((d) => ({ districtSlug: d.district_slug, km: d.km, note: d.note }))),
    );
  });
  return result;
}

export async function seedHook(ctx: SeedContext): Promise<SeedResult> {
  const seed = await readShippingSeed(ctx.seedDir);
  if (!seed) return { inserted: 0, updated: 0, skipped: 0, notes: ['no shipping.json in the seed directory; delivery setup left to the admin'] };
  return loadShippingSeed(seed, { dryRun: ctx.dryRun });
}
