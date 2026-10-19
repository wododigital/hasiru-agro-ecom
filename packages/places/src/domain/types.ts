import { z } from 'zod';

const num = z.number().finite();
const range = (lo: number, hi: number) => num.min(lo).max(hi);

export const climateSchema = z.object({
  temp_min: range(-20, 50),
  temp_max: range(-20, 55),
  humidity_min: range(0, 100),
  humidity_max: range(0, 100),
  rain_mm: range(0, 12000),
});
export type DistrictClimate = z.infer<typeof climateSchema>;

export const districtRecordSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1),
  state_code: z.string().length(2),
  aliases: z.array(z.string()),
  /** HQ coordinates from the bundled static table; null only when the table has no entry. */
  lat: range(6, 38).nullable(),
  lng: range(68, 98).nullable(),
  distance_km: num.min(0).nullable(),
  /** How `distance_km` was set: handoff sample, computed haversine x 1.3, or unknown. */
  distance_source: z.enum(['handoff', 'haversine', 'none']),
  climate: climateSchema,
  soil_text: z.string(),
  soil_tags: z.array(z.string()),
  rivers: z.array(z.string()),
  native_crops: z.array(z.string()),
  counts: z.object({ taluks: num.nullable(), hoblis: num.nullable(), villages: num.nullable() }),
  page_enabled: z.boolean(),
  data_source: z.enum(['client_sheet', 'derived']),
  review_notes: z.array(z.string()),
});
export type DistrictRecord = z.infer<typeof districtRecordSchema>;

export const stateRecordSchema = z.object({
  code: z.string().length(2),
  name: z.string(),
  gst_state_code: z.string().regex(/^\d{2}$/),
});
export type StateRecord = z.infer<typeof stateRecordSchema>;

/** `data/seed/districts.json` (SCHEMA.md). */
export const districtsFileSchema = z.object({
  version: z.literal(1),
  generated_at: z.string(),
  sources: z.array(z.string()),
  records: z.object({ states: z.array(stateRecordSchema), districts: z.array(districtRecordSchema) }),
});
export type DistrictsFile = z.infer<typeof districtsFileSchema>;

/** `data/seed/district-hq.json`: one entry per sheet row, keyed `STATE_CODE:sheet district name`. */
export const hqTableSchema = z.object({
  version: z.literal(1),
  source: z.string(),
  attribution: z.string(),
  records: z.record(
    z.string(),
    z.object({
      lat: range(6, 38),
      lng: range(68, 98),
      /** `verified` when the geocoder result named the right state; `check` needs a human look. */
      status: z.enum(['verified', 'check', 'manual']),
      matched: z.string(),
    }),
  ),
});
export type HqTable = z.infer<typeof hqTableSchema>;
