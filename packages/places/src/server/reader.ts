import 'server-only';
import type { ClimateFit, DistrictRef, PlaceSuggestion, PlacesReader, PlantClimate } from '@ecomkit/core/contracts';
import type { DbOrTx } from '@ecomkit/core/db';
import { buildIndex, computeFit, nearest, suggestDistricts, type DistrictFitData, type FitInput, type ScoredFit } from '../domain';
import { loadDistricts, loadStates, type DistrictRow } from './repo';

/** Everything the readers need, built from the database once and reused (645 small rows). */
export interface PlacesSnapshot {
  districts: Map<string, DistrictRow>;
  refs: Map<string, DistrictRef>;
  index: ReturnType<typeof buildIndex>;
  /** Pairs for "use my location" nearest-district lookups. */
  points: { lat: number; lng: number; slug: string }[];
  loadedAt: number;
}

export function toRef(row: DistrictRow, stateName: string, gstStateCode: string): DistrictRef {
  return {
    slug: row.slug,
    name: row.name,
    stateCode: row.stateCode,
    stateName,
    gstStateCode,
    distanceKm: row.distanceKmFromNursery,
    lat: row.hqLat,
    lng: row.hqLng,
  };
}

export function fitData(row: DistrictRow): DistrictFitData {
  return {
    climate: { temp_min: row.tempMin, temp_max: row.tempMax, humidity_min: row.humidityMin, humidity_max: row.humidityMax, rain_mm: row.rainfallMm },
    soilTags: row.soilTags,
    nativeCrops: row.nativeCrops,
  };
}

export async function buildSnapshot(db: DbOrTx, now = Date.now()): Promise<PlacesSnapshot> {
  const [states, rows] = await Promise.all([loadStates(db), loadDistricts(db)]);
  const stateByCode = new Map(states.map((s) => [s.code, s]));
  const districts = new Map<string, DistrictRow>();
  const refs = new Map<string, DistrictRef>();
  const entries: { district: DistrictRef; aliases: string[] }[] = [];
  const points: PlacesSnapshot['points'] = [];
  for (const row of rows) {
    const st = stateByCode.get(row.stateCode);
    const ref = toRef(row, st?.name ?? row.stateCode, st?.gstCode ?? '');
    districts.set(row.slug, row);
    refs.set(row.slug, ref);
    entries.push({ district: ref, aliases: row.aliases });
    if (row.hqLat !== null && row.hqLng !== null) points.push({ lat: row.hqLat, lng: row.hqLng, slug: row.slug });
  }
  return { districts, refs, index: buildIndex(entries), points, loadedAt: now };
}

/** The `places` service. `getSnapshot` is injected so the app can cache it and tests can pass a fixed one. */
export function createPlacesReader(getSnapshot: () => Promise<PlacesSnapshot>): PlacesReader & {
  fitScored(districtSlug: string, plant: FitInput): Promise<ScoredFit | null>;
  nearest(lat: number, lng: number): Promise<DistrictRef | null>;
  /** Districts where this plant fits (`good` first), for "Grows well in" lists. Enabled pages only when `linkable`. */
  districtsFor(plant: FitInput, options?: { stateCode?: string; limit?: number; linkable?: boolean }): Promise<{ district: DistrictRef; fit: ScoredFit; pageEnabled: boolean }[]>;
} {
  const fitScored = async (districtSlug: string, plant: FitInput): Promise<ScoredFit | null> => {
    const row = (await getSnapshot()).districts.get(districtSlug);
    return row ? computeFit(fitData(row), plant) : null;
  };
  return {
    async suggest(query: string, limit = 6): Promise<PlaceSuggestion[]> {
      return suggestDistricts((await getSnapshot()).index, query, limit);
    },
    async getDistrict(slug: string): Promise<DistrictRef | null> {
      return (await getSnapshot()).refs.get(slug) ?? null;
    },
    async fit(districtSlug: string, climate: PlantClimate): Promise<ClimateFit> {
      const scored = await fitScored(districtSlug, climate);
      // An unknown district cannot be judged: say "ok" with no reasons rather than blocking a purchase.
      return scored ? { level: scored.level, reasons: scored.reasons } : { level: 'ok', reasons: [] };
    },
    fitScored,
    async districtsFor(plant, options = {}) {
      const snap = await getSnapshot();
      const out: { district: DistrictRef; fit: ScoredFit; pageEnabled: boolean }[] = [];
      for (const row of snap.districts.values()) {
        if (options.stateCode && row.stateCode !== options.stateCode) continue;
        if (options.linkable && !row.pageEnabled) continue;
        const fit = computeFit(fitData(row), plant);
        if (fit.level === 'good') out.push({ district: snap.refs.get(row.slug)!, fit, pageEnabled: row.pageEnabled });
      }
      out.sort((a, b) => b.fit.score - a.fit.score || (a.district.distanceKm ?? 1e9) - (b.district.distanceKm ?? 1e9) || a.district.slug.localeCompare(b.district.slug));
      return out.slice(0, options.limit ?? 12);
    },
    async nearest(lat: number, lng: number): Promise<DistrictRef | null> {
      const snap = await getSnapshot();
      const hit = nearest({ lat, lng }, snap.points);
      return hit ? (snap.refs.get(hit.slug) ?? null) : null;
    },
  };
}
