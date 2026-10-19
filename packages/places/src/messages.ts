// Default copy for the places module. The host overrides any key in apps/shop/messages/en.ts.
export const placesMessages = {
  suggest: {
    placeholder: 'Search your district or pincode',
    noResults: 'No matching district. Try the nearest big town.',
    useMyLocation: 'Use my location',
  },
  district: {
    title: 'Best plants to grow in {district}',
    metaDescription: 'Plants that suit the climate of {district}, {state}: {tempMin} to {tempMax} C, about {rain} mm of rain a year. Healthy saplings from Hasiru Agro, delivered to your farm.',
    breadcrumbPlants: 'Plants',
    heroKicker: '{state}',
    climateHeading: 'Climate in {district}',
    temperature: 'Average temperature',
    humidity: 'Humidity',
    rainfall: 'Rainfall per year',
    rainfallUnit: 'mm',
    soilHeading: 'Soil',
    riversHeading: 'Rivers',
    nativeCropsHeading: 'Crops grown here',
    plantsHeading: 'Plants that suit {district}',
    plantsEmpty: 'We are matching plants to this district. Browse the full range meanwhile.',
    browseAll: 'Browse all plants',
    planCta: 'Plan a planting for my land',
    distance: 'About {km} km from our nursery',
    needsIrrigation: 'Needs irrigation',
    lightIrrigation: 'Light irrigation',
    nativeHere: 'Grown here',
  },
  fit: {
    good: 'Suits this district',
    ok: 'Works with care',
    not_recommended: 'Not recommended here',
    reasons: {
      'fit.too_cold': 'Too cold for this plant',
      'fit.too_hot': 'Too hot for this plant',
      'fit.temp_marginal_cold': 'A little cold for this plant',
      'fit.temp_marginal_hot': 'A little hot for this plant',
      'fit.too_dry': 'Too dry without heavy irrigation',
      'fit.needs_irrigation': 'Needs regular irrigation',
      'fit.light_irrigation': 'Light irrigation in dry months',
      'fit.waterlogging_risk': 'Needs good drainage in heavy rain',
      'fit.too_wet': 'Too wet for this plant',
      'fit.humidity_mismatch': 'Humidity is outside its usual range',
      'fit.soil_match': 'Soil here suits it',
      'fit.native_crop': 'Commonly grown in this district',
    } as Record<string, string>,
  },
  admin: {
    title: 'District pages',
    help: 'A district page is published when it is switched on here. Pages with fewer than six fitting plants are held back from search engines until more plants fit.',
  },
} as const;
export type PlacesMessages = typeof placesMessages;

export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));
}
