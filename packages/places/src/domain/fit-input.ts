import { z } from 'zod';
import type { FitInput } from './fit';

const rng = z.object({ min: z.number(), max: z.number() });
const withOpt = rng.extend({ opt: z.number().nullable().optional() });

/** The slice of a normalized product record (data/seed/SCHEMA.md) the fit rules read. */
export const seedPlantSchema = z.object({
  kind: z.literal('plant'),
  sku: z.string(),
  status: z.string().optional(),
  name_en: z.string(),
  base_name: z.string().nullish(),
  scientific_name: z.string().nullish(),
  plant: z.object({
    drought_tolerance: z.enum(['low', 'moderate', 'high']).nullish(),
    climate: z.object({
      temp_c: withOpt.nullish(),
      humidity_pct: withOpt.nullish(),
      rainfall_mm: rng.nullish(),
      soil_tags: z.array(z.string()).nullish(),
    }),
  }),
});
export type SeedPlant = z.infer<typeof seedPlantSchema>;

/** Maps a product record to the rules' input. Names are the base name and the full English name. */
export function fitInputFromSeedPlant(p: SeedPlant): FitInput {
  const c = p.plant.climate;
  return {
    tempC: c.temp_c ? { min: c.temp_c.min, max: c.temp_c.max, opt: c.temp_c.opt ?? null } : null,
    rainfallMm: c.rainfall_mm ? { min: c.rainfall_mm.min, max: c.rainfall_mm.max } : null,
    humidityPct: c.humidity_pct ? { min: c.humidity_pct.min, max: c.humidity_pct.max, opt: c.humidity_pct.opt ?? null } : null,
    soilTags: c.soil_tags ?? [],
    droughtTolerance: p.plant.drought_tolerance ?? null,
    names: [p.base_name, p.name_en].filter((n): n is string => Boolean(n)),
  };
}
