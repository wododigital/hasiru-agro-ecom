import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetEnv } from '@ecomkit/core/env';
import { getSettings } from '@ecomkit/core/settings';
import { createTestDb, type TestDb } from '@ecomkit/core/testing';
import type { FitInput } from '../src/domain';
import { placesDistrict, placesPincode } from '../src/schema';
import { placesSettings } from '../src/settings';
import { GET as pincodeGet } from '../src/routes/api-pincode';
import { GET as suggestGet } from '../src/routes/api-suggest';
import { GET as nearestGet } from '../src/routes/api-nearest';
import { buildSnapshot, createPlacesReader, getDistrictPage, invalidatePlacesCache, registerPlantSource, runPlacesSeed, type DistrictPlant } from '../src/server';
import { findPincode } from '../src/server/repo';

const SEED = join(__dirname, '..', '..', '..', 'data', 'seed');
let t: TestDb;
const dirs: string[] = [];
const ctx = (seedDir: string, dryRun = false) => ({ seedDir, mediaDir: seedDir, dryRun, log: { info: () => undefined, warn: () => undefined, error: () => undefined } });

function seedDir(withPincodes: boolean): string {
  const d = mkdtempSync(join(tmpdir(), 'wp13-db-'));
  dirs.push(d);
  cpSync(join(SEED, 'districts.json'), join(d, 'districts.json'));
  if (withPincodes) {
    writeFileSync(join(d, 'pincodes.csv'), ['pincode,office_name,district_slug,state_code', '560001,Bangalore,bengaluru-urban,KA', '570001,Mysore,mysuru,KA', '999999,Nowhere,,KA'].join('\n') + '\n');
  }
  return d;
}

beforeAll(async () => {
  t = await createTestDb('wp-13', { schemas: ['core', 'places'] });
  process.env.INTERNAL_SECRET = 'test-internal-secret-0123456789-abcdefghij';
  resetEnv();
});
afterAll(async () => {
  await t.close();
  dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
});

describe('places seed hook', () => {
  it('without a pincode file it loads districts and switches pincode lookup off', async () => {
    const r = await runPlacesSeed(ctx(seedDir(false)));
    expect(r.inserted).toBeGreaterThan(640);
    expect(r.notes?.join(' ')).toMatch(/pincode_lookup set to false/);
    expect((await getSettings(placesSettings)).pincode_lookup).toBe(false);
  });

  it('a second run changes zero rows', async () => {
    const dir = seedDir(true);
    const first = await runPlacesSeed(ctx(dir));
    expect(first.inserted).toBe(3);
    const second = await runPlacesSeed(ctx(dir));
    expect({ inserted: second.inserted, updated: second.updated }).toEqual({ inserted: 0, updated: 0 });
    expect(second.skipped).toBeGreaterThan(640);
  });

  it('leaves districts edited by staff alone', async () => {
    await t.db.update(placesDistrict).set({ distanceKmFromNursery: 123, adminLocked: true }).where(eq(placesDistrict.slug, 'hassan'));
    const r = await runPlacesSeed(ctx(seedDir(true)));
    expect(r.updated).toBe(0);
    const [row] = await t.db.select().from(placesDistrict).where(eq(placesDistrict.slug, 'hassan'));
    expect(row!.distanceKmFromNursery).toBe(123);
    await t.db.update(placesDistrict).set({ distanceKmFromNursery: null, adminLocked: false }).where(eq(placesDistrict.slug, 'hassan'));
  });

  it('dry run reports counts and writes nothing', async () => {
    await t.db.delete(placesPincode);
    const r = await runPlacesSeed(ctx(seedDir(true), true));
    expect(r.inserted).toBe(3);
    expect(await t.db.select().from(placesPincode)).toHaveLength(0);
  });

  it('stores pincodes with their district, and an unmatched district as null', async () => {
    await runPlacesSeed(ctx(seedDir(true)));
    expect(await findPincode(t.db, '560001')).toMatchObject({ officeName: 'Bangalore', stateCode: 'KA', districtSlug: 'bengaluru-urban' });
    expect(await findPincode(t.db, '999999')).toMatchObject({ districtSlug: null });
    expect(await findPincode(t.db, '111111')).toBeNull();
  });
});

describe('places reader', () => {
  const reader = () => createPlacesReader(() => buildSnapshot(t.db));
  const mango: FitInput = { tempC: { min: 15, max: 38, opt: 27 }, rainfallMm: { min: 500, max: 2500 }, humidityPct: { min: 30, max: 90, opt: 60 }, soilTags: [], droughtTolerance: 'moderate', names: ['Mango'] };

  it('suggests by old spelling and returns the GST code and distance', async () => {
    const [hit] = await reader().suggest('Mysore');
    expect(hit).toMatchObject({ kind: 'alias', district: { slug: 'mysuru', stateCode: 'KA', gstStateCode: '29', distanceKm: 150 } });
    expect((await reader().suggest('raicur'))[0]?.district.slug).toBe('raichur');
    expect((await reader().suggest('Vijayanagara'))[0]?.district.slug).toBe('vijayanagara');
    expect(await reader().suggest('m')).toEqual([]);
  });

  it('judges fit from the stored climate', async () => {
    const r = reader();
    expect((await r.fit('hassan', mango)).level).toBe('good');
    // Mysuru's sheet minimum of 11 C is 2 C below the mango's slack: workable, not ideal
    expect((await r.fit('mysuru', mango)).reasons).toContain('fit.temp_marginal_cold');
    expect((await r.fit('lahaul-and-spiti', mango)).level).toBe('not_recommended');
    expect(await r.fit('no-such-district', mango)).toEqual({ level: 'ok', reasons: [] });
    const where = await r.districtsFor(mango, { stateCode: 'KA', limit: 5 });
    expect(where.length).toBeGreaterThan(0);
    expect(where.every((w) => w.fit.level === 'good' && w.district.stateCode === 'KA')).toBe(true);
  });

  it('finds the nearest district to a point', async () => {
    expect((await reader().nearest(12.3, 76.65))?.slug).toBe('mysuru');
  });
});

describe('route handlers', () => {
  const req = (path: string) => new Request(`http://localhost${path}`, { headers: { 'x-real-ip': '203.0.113.7' } });

  it('suggest: validates, caches at the edge and finds districts and pincodes', async () => {
    expect((await suggestGet(req('/api/places/suggest?q=a'))).status).toBe(400);
    const res = await suggestGet(req('/api/places/suggest?q=mysore'));
    expect(res.headers.get('cache-control')).toMatch(/s-maxage=3600/);
    const body = (await res.json()) as { suggestions: { slug: string; kind: string }[] };
    expect(body.suggestions[0]).toMatchObject({ slug: 'mysuru', kind: 'alias' });

    // pincode lookup is on after pincodes were loaded in the seed tests
    await t.db.execute(sql`delete from core_settings where module = 'places'`);
    const pin = (await (await suggestGet(req('/api/places/suggest?q=560001'))).json()) as { suggestions: { kind: string; slug: string }[] };
    expect(pin.suggestions[0]).toMatchObject({ kind: 'pincode', slug: 'bengaluru-urban' });
  });

  it('pincode: found, unknown, malformed, and off', async () => {
    const ok = await pincodeGet(req('/api/places/pincode?code=570001'));
    expect(await ok.json()).toMatchObject({ found: true, office: 'Mysore', stateCode: 'KA', district: { slug: 'mysuru' } });
    expect((await pincodeGet(req('/api/places/pincode?code=111111'))).status).toBe(404);
    expect((await pincodeGet(req('/api/places/pincode?code=12ab'))).status).toBe(400);
    await t.db.execute(sql`insert into core_settings (module, key, value, is_secret) values ('places','pincode_lookup','false'::jsonb,false) on conflict (module, key) do update set value = excluded.value`);
    expect(await (await pincodeGet(req('/api/places/pincode?code=570001'))).json()).toEqual({ lookup: 'off' });
  });

  it('nearest: validates the range', async () => {
    expect((await nearestGet(req('/api/places/nearest?lat=0&lng=0'))).status).toBe(400);
    const body = (await (await nearestGet(req('/api/places/nearest?lat=12.3&lng=76.65'))).json()) as { district: { slug: string } };
    expect(body.district.slug).toBe('mysuru');
  });
});

describe('district page data and the 6+ rule', () => {
  const plant = (n: number, tmax = 38): DistrictPlant => ({
    sku: `HAP-${n}`,
    name: `Plant ${n}`,
    path: `/plant/p-${n}`,
    climate: { tempC: { min: 15, max: tmax, opt: 27 }, rainfallMm: { min: 500, max: 2500 }, humidityPct: null, soilTags: [], droughtTolerance: 'moderate', names: [`Plant ${n}`] },
  });

  it('is hidden unless an admin enabled the district', async () => {
    await t.db.update(placesDistrict).set({ pageEnabled: false }).where(eq(placesDistrict.slug, 'hassan'));
    invalidatePlacesCache();
    expect(await getDistrictPage('hassan')).toBeNull();
    expect(await getDistrictPage('no-such-district')).toBeNull();
  });

  it('without a plant source it shows facts only and stays indexable', async () => {
    await t.db.update(placesDistrict).set({ pageEnabled: true }).where(eq(placesDistrict.slug, 'hassan'));
    registerPlantSource(null);
    const page = await getDistrictPage('hassan');
    expect(page).toMatchObject({ plants: null, indexable: true, stateName: 'Karnataka' });
  });

  it('is indexable with six fitting plants and noindex with five', async () => {
    registerPlantSource(async () => [...Array.from({ length: 5 }, (_, i) => plant(i)), plant(99, 20)]); // the cold-tolerant one does not fit Mysuru
    let page = await getDistrictPage('hassan');
    expect(page!.fittingCount).toBe(5);
    expect(page!.indexable).toBe(false);
    registerPlantSource(async () => Array.from({ length: 6 }, (_, i) => plant(i)));
    page = await getDistrictPage('hassan');
    expect(page!.fittingCount).toBe(6);
    expect(page!.indexable).toBe(true);
    expect(page!.plants![0]!.fit.level).toBe('good');
    registerPlantSource(null);
  });
});
