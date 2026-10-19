export interface DistrictRef {
  slug: string;
  name: string;
  stateCode: string;
  stateName: string;
  /** Two-digit GST state code, decides CGST+SGST vs IGST. */
  gstStateCode: string;
  /** Road distance estimate from the nursery. Null when unknown. */
  distanceKm: number | null;
  lat: number | null;
  lng: number | null;
}

export interface PlaceSuggestion {
  kind: 'district' | 'pincode' | 'alias';
  label: string;
  district: DistrictRef;
}

export type FitLevel = 'good' | 'ok' | 'not_recommended';

export interface ClimateFit {
  level: FitLevel;
  /** Message keys, e.g. `fit.too_dry`, rendered by the host. */
  reasons: readonly string[];
}

export interface PlantClimate {
  tempC: { min: number; max: number; opt: number | null } | null;
  rainfallMm: { min: number; max: number } | null;
  humidityPct: { min: number; max: number; opt: number | null } | null;
  soilTags: readonly string[];
}

/** Service key `places`, provided by `@ecomkit/places`. */
export interface PlacesReader {
  suggest(query: string, limit?: number): Promise<PlaceSuggestion[]>;
  getDistrict(slug: string): Promise<DistrictRef | null>;
  fit(districtSlug: string, climate: PlantClimate): Promise<ClimateFit>;
}
