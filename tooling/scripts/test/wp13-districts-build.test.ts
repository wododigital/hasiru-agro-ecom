import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import districtsStep, { buildDistricts, HANDOFF_DISTANCES_KM, WORKBOOK, type SheetRow } from '../seed/districts';
// @boundaries-ignore tests of the seed scripts check them against the package's own schemas
import type { HqTable } from '../../../packages/places/src/domain';

const row = (state: string, district: string, over: Partial<SheetRow> = {}): SheetRow => ({
  state, district, taluks: 8, hoblis: 38, villages: 2369, soil: 'Red sandy soil, Black soil', rivers: 'Cauvery, Hemavati', humMin: 45, humMax: 79, tempMin: 20, tempMax: 35, rain: 1147, crops: 'Coffee, black pepper, and paddy', ...over,
});
const rows = [
  row('KARNATAKA', 'Mysore'),
  row('KARNATAKA', 'Ballari (Bellary)', { rain: 636 }),
  row('KARNATAKA', 'Hassan'),
  row('CHHATTISGARH', 'Bilaspur'),
  row('HIMACHAL PRADESH', 'Bilaspur'),
  row('TAMILNADU', 'Chennai'),
];
const hq: HqTable = {
  version: 1, source: 'test', attribution: 'test',
  records: {
    'KA:Mysore': { lat: 12.2958, lng: 76.6394, status: 'verified', matched: 'Mysuru' },
    'KA:Ballari (Bellary)': { lat: 15.1394, lng: 76.9214, status: 'check', matched: 'Ballari' },
    'KA:Hassan': { lat: 13.0068, lng: 76.1004, status: 'verified', matched: 'Hassan' },
    'KA:Vijayanagara': { lat: 15.27, lng: 76.39, status: 'verified', matched: 'Hosapete' },
    'CG:Bilaspur': { lat: 22.08, lng: 82.14, status: 'verified', matched: 'Bilaspur' },
    'HP:Bilaspur': { lat: 31.33, lng: 76.76, status: 'verified', matched: 'Bilaspur' },
    'TN:Chennai': { lat: 13.0827, lng: 80.2707, status: 'verified', matched: 'Chennai' },
  },
};
const T = '2026-10-20T00:00:00+05:30';

describe('buildDistricts', () => {
  const { file } = buildDistricts(rows, hq, [], T);
  const by = (slug: string) => file.records.districts.find((d) => d.slug === slug)!;

  it('canonicalises names, keeps aliases and adds Vijayanagara flagged with the Ballari climate', () => {
    expect(by('mysuru')).toMatchObject({ name: 'Mysuru', aliases: expect.arrayContaining(['Mysore']), state_code: 'KA' });
    expect(by('ballari').aliases).toContain('Bellary');
    const v = by('vijayanagara');
    expect(v).toMatchObject({ data_source: 'derived', climate: by('ballari').climate });
    expect(v.review_notes.join(' ')).toMatch(/copied from Ballari/);
  });

  it('disambiguates same-named districts by state', () => {
    expect(file.records.districts.map((d) => d.slug).filter((s) => s.startsWith('bilaspur')).sort()).toEqual(['bilaspur-cg', 'bilaspur-hp']);
  });

  it('uses the handoff distance when there is one and haversine x 1.3 otherwise', () => {
    expect(by('mysuru')).toMatchObject({ distance_km: HANDOFF_DISTANCES_KM['KA:Mysuru'], distance_source: 'handoff' });
    expect(by('chennai')).toMatchObject({ distance_km: 350, distance_source: 'handoff' });
    const bilaspur = by('bilaspur-cg');
    expect(bilaspur.distance_source).toBe('haversine');
    expect(bilaspur.distance_km! % 5).toBe(0);
    expect(bilaspur.distance_km).toBeGreaterThan(1000);
  });

  it('parses soil, rivers and crops and flags uncertain positions', () => {
    expect(by('hassan')).toMatchObject({ rivers: ['Cauvery', 'Hemavati'], native_crops: ['coffee', 'black pepper', 'paddy'] });
    expect([...by('hassan').soil_tags].sort()).toEqual(['black', 'red', 'sandy']);
    expect(by('ballari').review_notes.join(' ')).toMatch(/district centre/);
  });

  it('enables pages for Karnataka only, before plants exist', () => {
    expect(by('hassan').page_enabled).toBe(true);
    expect(by('chennai').page_enabled).toBe(false);
    expect(by('bilaspur-cg').page_enabled).toBe(false);
  });

  it('applies the 6+ rule at seed time once plants are known', () => {
    const plant = (n: number, tmax: number) => ({
      kind: 'plant', sku: `HAP-${n}`, status: 'active', name_en: `Plant ${n}`, base_name: `Plant ${n}`,
      plant: { drought_tolerance: 'moderate', climate: { temp_c: { min: 15, max: tmax, opt: 25 }, humidity_pct: { min: 30, max: 90 }, rainfall_mm: { min: 500, max: 2500 }, soil_tags: [] } },
    });
    const six = Array.from({ length: 6 }, (_, i) => plant(i, 38));
    expect(buildDistricts(rows, hq, six, T).file.records.districts.find((d) => d.slug === 'hassan')!.page_enabled).toBe(true);
    const five = Array.from({ length: 5 }, (_, i) => plant(i, 38));
    expect(buildDistricts(rows, hq, five, T).file.records.districts.find((d) => d.slug === 'hassan')!.page_enabled).toBe(false);
    // plants too cold-tolerant for Hassan do not count
    const wrong = Array.from({ length: 8 }, (_, i) => plant(i, 20));
    expect(buildDistricts(rows, hq, wrong, T).file.records.districts.find((d) => d.slug === 'hassan')!.page_enabled).toBe(false);
  });

  it('is deterministic and sorted by slug', () => {
    const again = buildDistricts([...rows].reverse(), hq, [], T).file;
    expect(again.records).toEqual(file.records);
    const slugs = file.records.districts.map((d) => d.slug);
    expect(slugs).toEqual([...slugs].sort());
  });
});

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe.skipIf(!existsSync(WORKBOOK))('districts step against the real workbook', () => {
  const seedSrc = join(__dirname, '..', '..', '..', 'data', 'seed');
  const mk = () => {
    const d = mkdtempSync(join(tmpdir(), 'wp13-seed-'));
    dirs.push(d);
    cpSync(join(seedSrc, 'district-hq.json'), join(d, 'district-hq.json'));
    return d;
  };
  const ctx = (seedDir: string, dryRun: boolean) => ({ seedDir, mediaDir: seedDir, dryRun, log: { info: () => undefined, warn: () => undefined, error: () => undefined } });

  it('--dry-run writes nothing', async () => {
    const dir = mk();
    const before = readdirSync(dir).sort();
    await districtsStep(ctx(dir, true));
    expect(readdirSync(dir).sort()).toEqual(before);
    expect(existsSync(join(dir, 'districts.json'))).toBe(false);
  });

  it('a second run leaves the file byte-identical', async () => {
    const dir = mk();
    await districtsStep(ctx(dir, false));
    const first = readFileSync(join(dir, 'districts.json'), 'utf8');
    await districtsStep(ctx(dir, false));
    expect(readFileSync(join(dir, 'districts.json'), 'utf8')).toBe(first);
  });
});
