import { z } from 'zod';
import { PACKING_SCOPES } from './packing';
import { METHOD_KINDS, ZONE_KINDS } from './quote';

// `data/seed/shipping.json`: the store's starting delivery setup. Money in whole rupees (data/seed/SCHEMA.md rule).

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const shippingSeedSchema = z.object({
  version: z.literal(1),
  records: z.object({
    zones: z
      .array(
        z.object({
          slug,
          name: z.string().min(1).max(80),
          kind: z.enum(ZONE_KINDS),
          district_slugs: z.array(slug).default([]),
          state_codes: z.array(z.string().regex(/^[A-Z]{2}$/)).default([]),
        }),
      )
      .default([]),
    methods: z
      .array(
        z.object({
          name: z.string().min(1).max(80),
          kind: z.enum(METHOD_KINDS),
          zone_slug: slug.nullable().default(null),
          rules: z.record(z.string(), z.unknown()).default({}),
        }),
      )
      .default([]),
    vehicles: z
      .array(
        z.object({
          name: z.string().min(1).max(80),
          capacity_kg: z.int().positive(),
          local_flat_rs: z.number().nonnegative(),
          per_km_rs: z.number().nonnegative(),
        }),
      )
      .default([]),
    slots: z
      .array(z.object({ weekday: z.int().min(0).max(6), cutoff_hours: z.int().min(0).max(24 * 14), capacity_kg: z.int().positive().nullable().default(null) }))
      .default([]),
    packing_rules: z.array(z.object({ scope: z.enum(PACKING_SCOPES), match: z.record(z.string(), z.unknown()).default({}), fee_rs: z.number().nonnegative() })).default([]),
    distance_overrides: z.array(z.object({ district_slug: slug, km: z.number().nonnegative(), note: z.string().max(200).nullable().default(null) })).default([]),
  }),
});
export type ShippingSeed = z.output<typeof shippingSeedSchema>;
