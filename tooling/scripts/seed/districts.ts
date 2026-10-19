// WP-13 seed step 6: the 644-row district sheet -> data/seed/districts.json (BUILD-PLAN 9.6, SCHEMA.md).
// Deterministic: same inputs give byte-identical records. Reads the sheet, the bundled HQ table
// (data/seed/district-hq.json, produced once by geocode-districts.ts) and, when present, data/seed/products.json.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// @boundaries-ignore type-only: core is loaded at runtime through the app's dependency graph
import type { SeedContext } from '../../../packages/core/src/contracts/extensions';
// @boundaries-ignore the seed pipeline reuses the package's pure domain code instead of a second copy
import {
  assignSlugs,
  noDashes,
  canonicalDistrict,
  computeFit,
  districtsFileSchema,
  fitInputFromSeedPlant,
  hqTableSchema,
  meetsPageRule,
  parseList,
  roadDistanceKm,
  seedPlantSchema,
  soilTags,
  STATES,
  stateFromSheet,
  type DistrictRecord,
  type DistrictsFile,
  type HqTable,
} from '../../../packages/places/src/domain';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
/** Gitignored client workbook; lives only in the main checkout. */
export const WORKBOOK = process.env.HASIRU_WORKBOOK ?? '/Users/shyam/Desktop/Claude Dev Projects/hasiru-agro-ecom/latest_products.xlsx';
const SHEET = 'Dis-wise Geo data';

/** Nursery position used for distance estimates until the nursery's own coordinates are in settings: Bengaluru city centre. */
export const NURSERY_ORIGIN = { lat: 12.9716, lng: 77.5946 } as const;

/** Distances the client's prototype brief gave (HANDOFF "Mock distances"); they win over the haversine estimate. */
export const HANDOFF_DISTANCES_KM: Record<string, number> = {
  'KA:Mysuru': 150,
  'KA:Tumakuru': 70,
  'KA:Hassan': 185,
  'KA:Shivamogga': 300,
  'KA:Chikkamagaluru': 245,
  'KA:Dakshina Kannada': 350,
  'KA:Dharwad': 430,
  'KA:Belagavi': 500,
  'KA:Kolar': 70,
  'TN:Chennai': 350,
  'TN:Coimbatore': 365,
  'TG:Hyderabad': 570,
};

/** Neighbour whose temperatures stand in for a district whose sheet values are impossible. */
const TEMPERATURE_NEIGHBOUR: Record<string, string> = { 'UP:Kanpur Dehat': 'Kanpur Nagar' };

export interface SheetRow {
  state: string;
  district: string;
  taluks: number | null;
  hoblis: number | null;
  villages: number | null;
  soil: string;
  rivers: string;
  humMin: number;
  humMax: number;
  tempMin: number;
  tempMax: number;
  rain: number;
  crops: string;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The few SheetJS calls used here. tooling/scripts does not declare xlsx yet (cross-package request), so no static import. */
interface Xlsx {
  readFile(file: string): { Sheets: Record<string, { '!ref'?: string } | undefined> };
  utils: {
    decode_range(ref: string): { e: { r: number; c: number } };
    encode_range(range: { s: { r: number; c: number }; e: { r: number; c: number } }): string;
    sheet_to_json<T>(ws: unknown, options: { header: 1; defval: null; blankrows: false; range: string }): T[];
  };
}

async function loadXlsx(): Promise<Xlsx> {
  const name = 'xlsx';
  try {
    return (await import(name)) as Xlsx;
  } catch {
    // Fall back to the copy in the pnpm store (the catalog package depends on it).
    const store = join(ROOT, 'node_modules', '.pnpm');
    const dir = existsSync(store) ? readdirSync(store).find((d) => d.startsWith('xlsx@')) : undefined;
    if (!dir) throw new Error('xlsx is not installed');
    return createRequire(import.meta.url)(join(store, dir, 'node_modules', 'xlsx')) as Xlsx;
  }
}

export async function readSheet(file = WORKBOOK): Promise<SheetRow[]> {
  const XLSX = await loadXlsx();
  const wb = XLSX.readFile(file);
  const ws = wb.Sheets[SHEET];
  if (!ws) throw new Error(`sheet "${SHEET}" not found in ${file}`);
  // Column A is empty in the sheet; anchor the range at A1 so indices match the column letters (B = 1).
  const ref = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
  const range = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: ref.e });
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, blankrows: false, range });
  const out: SheetRow[] = [];
  for (const r of rows) {
    if (typeof r[1] !== 'number' || !r[3]) continue; // header rows and the blank Maharashtra row
    out.push({
      state: String(r[2]),
      district: String(r[3]),
      taluks: num(r[4]),
      hoblis: num(r[5]),
      villages: num(r[6]),
      soil: String(r[7] ?? ''),
      rivers: String(r[10] ?? ''),
      humMin: Number(r[11]),
      humMax: Number(r[12]),
      tempMin: Number(r[13]),
      tempMax: Number(r[14]),
      rain: Number(r[15]),
      crops: String(r[16] ?? ''),
    });
  }
  return out;
}

/** SCHEMA.md: generated_at carries the IST offset. */
export function istNow(now = new Date()): string {
  return `${new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 19)}+05:30`;
}

interface Built {
  file: DistrictsFile;
  warnings: string[];
}

/** Pure assembly step (tested): sheet rows + HQ table + optional plants -> districts file. */
export function buildDistricts(
  rows: readonly SheetRow[],
  hq: HqTable | null,
  plants: readonly unknown[] = [],
  generatedAt = istNow(),
): Built {
  const warnings: string[] = [];
  // Sheet cells that cannot be right (Kanpur Dehat lists a 99 C maximum) take the temperatures of a neighbour, flagged.
  const bySheet = new Map(rows.map((r) => [`${r.state}|${r.district}`, r]));
  const prelim = rows.map((r) => {
    const st = stateFromSheet(r.state);
    if (!st) throw new Error(`unknown state "${r.state}"`);
    const c = canonicalDistrict(r.district, st.code);
    const invalidTemp = r.tempMax > 50 || r.tempMin < -5 || r.tempMin >= r.tempMax;
    const neighbour = invalidTemp ? bySheet.get(`${r.state}|${TEMPERATURE_NEIGHBOUR[`${st.code}:${r.district}`] ?? ''}`) : undefined;
    if (invalidTemp && !neighbour) throw new Error(`implausible temperatures for ${r.district} and no neighbour configured`);
    const fixed = neighbour ? { ...r, tempMin: neighbour.tempMin, tempMax: neighbour.tempMax } : r;
    return { r: fixed, st, c, tempFrom: neighbour ? neighbour.district : null };
  });

  // Karnataka's sheet lacks Vijayanagara (carved from Ballari in 2021): copy Ballari's climate, flagged.
  const ballari = prelim.find((p) => p.st.code === 'KA' && p.c.name === 'Ballari');
  const extra = ballari
    ? [
        {
          r: { ...ballari.r, district: 'Vijayanagara', taluks: null, hoblis: null, villages: null },
          st: ballari.st,
          c: { name: 'Vijayanagara', aliases: ['Hosapete', 'Hospet'], renamed: false },
          derived: true,
        },
      ]
    : [];
  const all = [...prelim.map((p) => ({ ...p, derived: false })), ...extra.map((e) => ({ ...e, tempFrom: null as string | null }))];
  const slugs = assignSlugs(all.map((p) => ({ name: p.c.name, stateCode: p.st.code })));

  const fitPlants = plants
    .map((p) => seedPlantSchema.safeParse(p))
    .filter((p) => p.success && p.data.status !== 'archived')
    .map((p) => fitInputFromSeedPlant((p as { data: Parameters<typeof fitInputFromSeedPlant>[0] }).data));

  const districts: DistrictRecord[] = all.map((p, i) => {
    const key = `${p.st.code}:${p.r.district}`;
    const notes: string[] = [];
    if (p.derived) notes.push('Not in the client sheet. Climate, soil and crops copied from Ballari; confirm with the client.');
    if (p.tempFrom) notes.push(`The sheet's temperatures for this district are implausible; copied from ${p.tempFrom}. Confirm with the client.`);
    if (p.c.renamed) notes.push(`Sheet spelling "${p.r.district}" normalised to "${p.c.name}".`);
    if (p.st.code === 'AP') notes.push('Sheet lists the 13 pre-2022 Andhra Pradesh districts; kept as given.');
    if (p.st.code === 'TG' || p.st.code === 'MH') notes.push('District list is from the client sheet; recent splits may be missing.');

    const point = hq?.records[p.derived ? 'KA:Vijayanagara' : key];
    if (point && point.status === 'check') notes.push(`Position is the district centre from OpenStreetMap, not the headquarters town (${point.matched}); distance is approximate.`);
    if (!point) notes.push('No HQ position in the bundled table; distance unknown.');
    const handoff = HANDOFF_DISTANCES_KM[`${p.st.code}:${p.c.name}`];
    const distance = handoff ?? (point ? roadDistanceKm(NURSERY_ORIGIN, point) : null);

    const climate = {
      temp_min: p.r.tempMin,
      temp_max: p.r.tempMax,
      humidity_min: p.r.humMin,
      humidity_max: p.r.humMax,
      rain_mm: p.r.rain,
    };
    const tags = soilTags(p.r.soil);
    const crops = parseList(noDashes(p.r.crops));
    const fits = fitPlants.map((pl) => computeFit({ climate, soilTags: tags, nativeCrops: crops }, pl));
    // Karnataka districts get a page when 6+ plants fit; before the plant list exists they default to enabled.
    const pageEnabled = p.st.code === 'KA' && (fitPlants.length ? meetsPageRule(fits) : true);

    return {
      slug: slugs[i]!,
      name: p.c.name,
      state_code: p.st.code,
      aliases: p.c.aliases,
      lat: point?.lat ?? null,
      lng: point?.lng ?? null,
      distance_km: distance,
      distance_source: handoff !== undefined ? 'handoff' : distance !== null ? 'haversine' : 'none',
      climate,
      soil_text: noDashes(p.r.soil),
      soil_tags: tags,
      rivers: parseList(noDashes(p.r.rivers), { lower: false }),
      native_crops: crops,
      counts: { taluks: p.r.taluks, hoblis: p.r.hoblis, villages: p.r.villages },
      page_enabled: pageEnabled,
      data_source: p.derived ? 'derived' : 'client_sheet',
      review_notes: notes,
    };
  });
  districts.sort((a, b) => a.slug.localeCompare(b.slug));
  if (new Set(districts.map((d) => d.slug)).size !== districts.length) throw new Error('duplicate district slug');

  const file = districtsFileSchema.parse({
    version: 1,
    generated_at: generatedAt,
    sources: ['latest_products.xlsx (Dis-wise Geo data)', 'data/seed/district-hq.json', ...(fitPlants.length ? ['data/seed/products.json'] : [])],
    records: {
      states: STATES.map((s) => ({ code: s.code, name: s.name, gst_state_code: s.gstStateCode })),
      districts,
    },
  });
  if (!fitPlants.length) warnings.push('data/seed/products.json not found: Karnataka page_enabled defaults to true, the 6+ rule is applied at render time.');
  return { file, warnings };
}

const readJson = (path: string): unknown => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);

export default async function districts(ctx: SeedContext): Promise<void> {
  const rows = await readSheet();
  const hqRaw = readJson(join(ctx.seedDir, 'district-hq.json'));
  const hq = hqRaw ? hqTableSchema.parse(hqRaw) : null;
  const productsRaw = readJson(join(ctx.seedDir, 'products.json')) as { records?: unknown[] } | null;
  const { file, warnings } = buildDistricts(rows, hq, productsRaw?.records ?? []);
  for (const w of warnings) ctx.log.warn(`districts: ${w}`);

  const target = join(ctx.seedDir, 'districts.json');
  // SCHEMA.md: write only when records changed, so generated_at is the only field that may differ.
  const previous = readJson(target) as DistrictsFile | null;
  if (previous && JSON.stringify(previous.records) === JSON.stringify(file.records) && JSON.stringify(previous.sources) === JSON.stringify(file.sources)) {
    ctx.log.info('districts: unchanged');
    return;
  }
  if (ctx.dryRun) {
    ctx.log.info(`districts: dry run, would write ${file.records.districts.length} districts`);
    return;
  }
  writeFileSync(target, `${JSON.stringify(file, null, 2)}\n`);
  ctx.log.info(`districts: wrote ${file.records.districts.length} districts in ${file.records.states.length} states`);
}
