import type { DistrictFitData, FitInput } from '../src/domain';

/** Annual-average climate bands from the client sheet style: Hassan-like, a dry plateau district and a wet coastal one. */
export const HASSAN: DistrictFitData = {
  climate: { temp_min: 20, temp_max: 35, humidity_min: 45, humidity_max: 79, rain_mm: 1147 },
  soilTags: ['red', 'sandy', 'black'],
  nativeCrops: ['coffee', 'black pepper', 'potato', 'paddy', 'sugarcane'],
};
export const DRY_PLATEAU: DistrictFitData = {
  climate: { temp_min: 18, temp_max: 38, humidity_min: 40, humidity_max: 88, rain_mm: 562 },
  soilTags: ['sandy', 'loamy', 'black', 'red'],
  nativeCrops: ['groundnut', 'cotton', 'maize'],
};
export const WET_COAST: DistrictFitData = {
  climate: { temp_min: 22, temp_max: 33, humidity_min: 70, humidity_max: 95, rain_mm: 3900 },
  soilTags: ['laterite', 'coastal'],
  nativeCrops: ['coconut', 'areca', 'cashew'],
};
export const COLD_HILLS: DistrictFitData = {
  climate: { temp_min: 2, temp_max: 18, humidity_min: 50, humidity_max: 90, rain_mm: 1200 },
  soilTags: ['hill'],
  nativeCrops: ['apple'],
};

export const plant = (over: Partial<FitInput> = {}): FitInput => ({
  tempC: { min: 15, max: 38, opt: 27 },
  rainfallMm: { min: 500, max: 2500 },
  humidityPct: { min: 30, max: 85, opt: 60 },
  soilTags: [],
  droughtTolerance: 'moderate',
  names: ['Mango'],
  ...over,
});
