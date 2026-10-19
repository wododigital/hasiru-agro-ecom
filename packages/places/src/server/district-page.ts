import 'server-only';
import { db } from '@ecomkit/core/db';
import { meetsPageRule, rankFits, type ScoredFit } from '../domain';
import { getSnapshot } from './cache';
import { loadDistrictPlants, type DistrictPlant } from './plant-source';
import { fitData } from './reader';
import type { DistrictRow } from './repo';
import { findDistrictBySlug } from './repo';

export interface DistrictPageData {
  district: DistrictRow;
  stateName: string;
  /** Null when no plant source is registered (the page then shows facts only). */
  plants: { plant: DistrictPlant; fit: ScoredFit }[] | null;
  fittingCount: number | null;
  /** True when the page should be indexed: enabled and, if plants are known, 6+ fit. */
  indexable: boolean;
}

/** Page data for an enabled district, or null (404). Disabled districts never render. */
export async function getDistrictPage(slug: string): Promise<DistrictPageData | null> {
  const district = await findDistrictBySlug(db, slug);
  if (!district || !district.pageEnabled) return null;
  const snap = await getSnapshot();
  const stateName = snap.refs.get(slug)?.stateName ?? district.stateCode;
  const all = await loadDistrictPlants();
  if (!all) return { district, stateName, plants: null, fittingCount: null, indexable: true };
  const ranked = rankFits(
    fitData(district),
    all.map((plant) => ({ plant: plant.climate, item: plant })),
  );
  return {
    district,
    stateName,
    plants: ranked.map((r) => ({ plant: r.item, fit: r.fit })),
    fittingCount: ranked.length,
    indexable: meetsPageRule(ranked.map((r) => r.fit)),
  };
}

/** Slugs to prerender: enabled districts, Karnataka first. */
export async function listEnabledDistrictSlugs(): Promise<string[]> {
  const snap = await getSnapshot();
  return [...snap.districts.values()]
    .filter((d) => d.pageEnabled)
    .sort((a, b) => Number(b.stateCode === 'KA') - Number(a.stateCode === 'KA') || a.slug.localeCompare(b.slug))
    .map((d) => d.slug);
}
