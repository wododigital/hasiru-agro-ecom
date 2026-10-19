import type { CatalogMessages } from '../messages';

export interface FactSource {
  kind: string;
  scientificName: string | null;
  sizeClass: string | null;
  matureHeightMinFt: number | null;
  matureHeightMaxFt: number | null;
  bearingYearsMin: number | null;
  bearingYearsMax: number | null;
  timberRotationYears: number | null;
  attributes: Record<string, string | null>;
  yieldText: string | null;
  harvestSeason: string | null;
  exposure: string | null;
  waterNeed: string | null;
  droughtTolerance: string | null;
  tempMin: number | null;
  tempMax: number | null;
  rainfallMin: number | null;
  rainfallMax: number | null;
  propagation: string | null;
  nitrogenFixer: boolean;
  spacingFt: Record<string, [number, number] | number | null>;
  heightAtDispatchFt: number | null;
  bagSize: string | null;
  packSize: string | null;
}

/** The PDP key facts (with units); empty facts are left out. Also the JSON-LD additionalProperty list. */
export function productFacts(p: FactSource, messages: CatalogMessages): { name: string; value: string }[] {
  const f = messages.pdp.facts;
  const u = messages.pdp.units;
  const e = messages.pdp.enums;
  const out: { name: string; value: string }[] = [];
  const add = (name: string, value: string | null | undefined) => {
    if (value) out.push({ name, value });
  };
  add(f.scientificName, p.scientificName);
  add(f.sizeClass, p.sizeClass ? (messages.card.sizeClass[p.sizeClass] ?? p.sizeClass) : null);
  add(f.matureHeight, p.matureHeightMinFt != null || p.matureHeightMaxFt != null ? u.ft(p.matureHeightMinFt, p.matureHeightMaxFt) : null);
  add(f.bearing, p.attributes.bearing_years ?? (p.bearingYearsMin != null || p.bearingYearsMax != null ? u.years(p.bearingYearsMin, p.bearingYearsMax) : null));
  add(f.rotation, p.attributes.timber_rotation_years ?? (p.timberRotationYears != null ? u.years(p.timberRotationYears, null) : null));
  add(f.yield, p.yieldText);
  add(f.harvestSeason, p.harvestSeason);
  add(f.exposure, p.exposure ? (e.exposure[p.exposure] ?? p.exposure) : null);
  add(f.water, p.waterNeed ? (e.level[p.waterNeed] ?? p.waterNeed) : null);
  add(f.drought, p.droughtTolerance ? (e.level[p.droughtTolerance] ?? p.droughtTolerance) : null);
  add(f.temperature, p.tempMin != null && p.tempMax != null ? u.celsius(p.tempMin, p.tempMax) : null);
  add(f.rainfall, p.rainfallMin != null && p.rainfallMax != null ? u.rainfall(p.rainfallMin, p.rainfallMax) : null);
  add(f.propagation, p.propagation ? (e.propagation[p.propagation] ?? p.propagation) : null);
  if (p.nitrogenFixer) add(f.nitrogenFixer, u.yes);
  const spacing = Object.entries(p.spacingFt)
    .flatMap(([model, v]) => (v == null ? [] : [`${e.model[model] ?? model} ${Array.isArray(v) ? u.spacing(v[0], v[1]) : u.ft(v, null)}`]))
    .join(', ');
  add(f.spacing, spacing || null);
  add(f.dispatchHeight, p.heightAtDispatchFt != null ? u.ft(p.heightAtDispatchFt, null) : null);
  add(f.bagSize, p.bagSize);
  add(f.packSize, p.packSize);
  return out;
}
