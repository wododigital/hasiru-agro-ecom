import 'server-only';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import type { SeedContext, SeedResult } from '@ecomkit/core/contracts';
import { db, excluded, withTx, type DbOrTx } from '@ecomkit/core/db';
import { getSettings, setSettings } from '@ecomkit/core/settings';
import { districtsFileSchema, parseCsvLine, PINCODE_RE, type DistrictRecord } from '../domain';
import { placesDistrict, placesPincode, placesState } from '../schema';
import { placesSettings } from '../settings';
import { invalidatePlacesCache } from './cache';

type DistrictInsert = typeof placesDistrict.$inferInsert;

function districtValues(d: DistrictRecord): Omit<DistrictInsert, 'id'> {
  return {
    stateCode: d.state_code,
    slug: d.slug,
    name: d.name,
    aliases: d.aliases,
    hqLat: d.lat,
    hqLng: d.lng,
    distanceKmFromNursery: d.distance_km,
    soilText: d.soil_text,
    soilTags: d.soil_tags,
    tempMin: d.climate.temp_min,
    tempMax: d.climate.temp_max,
    humidityMin: d.climate.humidity_min,
    humidityMax: d.climate.humidity_max,
    rainfallMm: d.climate.rain_mm,
    rivers: d.rivers,
    nativeCrops: d.native_crops,
    taluks: d.counts.taluks,
    hoblis: d.counts.hoblis,
    villages: d.counts.villages,
    pageEnabled: d.page_enabled,
    dataSource: d.data_source,
    reviewNotes: d.review_notes,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function seedDistricts(tx: DbOrTx, file: ReturnType<typeof districtsFileSchema.parse>, dryRun: boolean, result: SeedResult) {
  const existingStates = new Map((await tx.select().from(placesState)).map((s) => [s.code, s]));
  for (const s of file.records.states) {
    const row = { code: s.code, name: s.name, gstCode: s.gst_state_code };
    const old = existingStates.get(s.code);
    if (!old) {
      result.inserted++;
      if (!dryRun) await tx.insert(placesState).values(row);
    } else if (old.name !== row.name || old.gstCode !== row.gstCode) {
      result.updated++;
      if (!dryRun) await tx.update(placesState).set(row).where(eq(placesState.code, s.code));
    } else result.skipped++;
  }
  const existing = new Map((await tx.select().from(placesDistrict)).map((d) => [d.slug, d]));
  for (const d of file.records.districts) {
    const values = districtValues(d);
    const old = existing.get(d.slug);
    if (!old) {
      result.inserted++;
      if (!dryRun) await tx.insert(placesDistrict).values(values);
      continue;
    }
    if (old.adminLocked) {
      result.skipped++;
      continue;
    }
    const changed = (Object.keys(values) as (keyof typeof values)[]).some((k) => !same(values[k], old[k as keyof typeof old]));
    if (!changed) {
      result.skipped++;
      continue;
    }
    result.updated++;
    if (!dryRun) await tx.update(placesDistrict).set({ ...values, updatedAt: new Date() }).where(eq(placesDistrict.slug, d.slug));
  }
}

async function seedPincodes(tx: DbOrTx, csvFile: string, dryRun: boolean, result: SeedResult) {
  const lines = readFileSync(csvFile, 'utf8').split(/\r?\n/).filter(Boolean).slice(1);
  const slugToId = new Map((await tx.select({ id: placesDistrict.id, slug: placesDistrict.slug }).from(placesDistrict)).map((r) => [r.slug, r.id]));
  const states = new Set((await tx.select({ code: placesState.code }).from(placesState)).map((s) => s.code));
  const rows: (typeof placesPincode.$inferInsert)[] = [];
  for (const line of lines) {
    const [pincode, officeName, slug, stateCode] = parseCsvLine(line);
    if (!pincode || !PINCODE_RE.test(pincode) || !stateCode || !states.has(stateCode)) continue;
    rows.push({ pincode, officeName: officeName ?? '', districtId: slug ? (slugToId.get(slug) ?? null) : null, stateCode });
  }
  if (dryRun) {
    const have = new Set(((await tx.select({ p: placesPincode.pincode }).from(placesPincode)) as { p: string }[]).map((r) => r.p));
    for (const r of rows) {
      if (have.has(r.pincode)) result.skipped++;
      else result.inserted++;
    }
    return rows.length;
  }
  for (let i = 0; i < rows.length; i += 2000) {
    const chunk = rows.slice(i, i + 2000);
    const changed = await tx
      .insert(placesPincode)
      .values(chunk)
      .onConflictDoUpdate({
        target: placesPincode.pincode,
        set: { officeName: excluded(placesPincode.officeName), districtId: excluded(placesPincode.districtId), stateCode: excluded(placesPincode.stateCode) },
        setWhere: sql`(${placesPincode.officeName}, ${placesPincode.districtId}, ${placesPincode.stateCode}) is distinct from (excluded.office_name, excluded.district_id, excluded.state_code)`,
      })
      .returning({ pincode: placesPincode.pincode, inserted: sql<boolean>`(xmax = 0)` });
    const inserted = changed.filter((c) => c.inserted).length;
    result.inserted += inserted;
    result.updated += changed.length - inserted;
    result.skipped += chunk.length - changed.length;
  }
  return rows.length;
}

/**
 * Seed hook: states, districts and pincodes from data/seed. Idempotent (a second run reports only skipped rows);
 * districts edited by staff (`admin_locked`) are left alone. Switches `pincode_lookup` off when no directory is loaded.
 */
export async function runPlacesSeed(ctx: SeedContext): Promise<SeedResult> {
  const result: SeedResult = { inserted: 0, updated: 0, skipped: 0, notes: [] };
  const notes: string[] = [];
  const districtsFile = join(ctx.seedDir, 'districts.json');
  if (!existsSync(districtsFile)) {
    return { ...result, notes: ['data/seed/districts.json is missing: run pnpm seed:build first'] };
  }
  const file = districtsFileSchema.parse(JSON.parse(readFileSync(districtsFile, 'utf8')));
  const csv = join(ctx.seedDir, 'pincodes.csv');

  const loaded = await withTx(async (tx) => {
    await seedDistricts(tx, file, ctx.dryRun, result);
    return existsSync(csv) ? seedPincodes(tx, csv, ctx.dryRun, result) : 0;
  });
  if (!existsSync(csv)) notes.push('data/seed/pincodes.csv not found: pincode lookup stays off');

  if (!ctx.dryRun) {
    const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(placesPincode);
    const current = await getSettings(placesSettings);
    if (n === 0 && current.pincode_lookup) {
      await setSettings(placesSettings, { pincode_lookup: false }, { actorId: null, actorType: 'system' });
      notes.push('no pincodes loaded: settings.places.pincode_lookup set to false');
    }
    invalidatePlacesCache();
  }
  notes.push(`${file.records.districts.length} districts, ${loaded} pincodes in the seed files`);
  return { ...result, notes };
}
