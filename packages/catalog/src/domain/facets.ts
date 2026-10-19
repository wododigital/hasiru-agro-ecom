import type { FacetSourceRow } from '@ecomkit/core/contracts';

export interface FacetInput {
  id: string;
  kind: string;
  collectionSlugs: readonly string[];
  sizeClass: string | null;
  propagation: string | null;
  exposure: string | null;
  droughtTolerance: string | null;
  waterNeed: string | null;
  nitrogenFixer: boolean;
  tagSlugs: readonly string[];
  tempMin: number | null;
  tempMax: number | null;
  rainfallMin: number | null;
  rainfallMax: number | null;
  bearingYearsMin: number | null;
  matureHeightMaxFt: number | null;
  hasYield: boolean;
}

const one = (v: string | null): string[] => (v ? [v] : []);

/**
 * One row of the search module's facet index. Facet values are stable codes (labels are the search
 * module's concern); numeric columns feed range filters. Price and stock come from their own modules.
 */
export function facetRow(p: FacetInput): FacetSourceRow {
  return {
    productId: p.id,
    facets: {
      kind: [p.kind],
      collection: [...p.collectionSlugs],
      size_class: one(p.sizeClass),
      propagation: one(p.propagation),
      exposure: one(p.exposure),
      drought_tolerance: one(p.droughtTolerance),
      water_need: one(p.waterNeed),
      nitrogen_fixer: p.nitrogenFixer ? ['yes'] : ['no'],
      tag: [...p.tagSlugs],
      yield_known: p.hasYield ? ['yes'] : [],
    },
    numeric: {
      temp_min: p.tempMin,
      temp_max: p.tempMax,
      rainfall_min: p.rainfallMin,
      rainfall_max: p.rainfallMax,
      bearing_years: p.bearingYearsMin,
      height_ft: p.matureHeightMaxFt,
    },
  };
}
