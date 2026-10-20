import { z } from 'zod';
import { defineSettings } from '@ecomkit/core/settings';

/** Planting settings (/admin/settings/planting, rendered by admin-shell from the manifest). */
export const plantingSettingsSchema = z.object({
  unlock_mode: z
    .enum(['soft', 'otp'])
    .default('soft')
    .meta({ group: 'Plan unlock', help: 'soft: name and phone unlock the plan and create an unverified lead. otp: a one-time code must be verified first (needs WhatsApp or email codes set up).' }),
  picks_per_role: z.coerce.number().int().min(1).max(8).default(3).meta({ group: 'Recommendations', help: 'How many plants each role (main, host, biomass) is split over.' }),
  build_for_me_path: z
    .string()
    .regex(/^\/[a-z0-9/_-]*$/)
    .default('/build-farm-with-us')
    .meta({ group: 'Recommendations', help: 'Page the "Build it for me" button opens (the plan details are passed as query parameters).' }),
});
export type PlantingSettings = z.infer<typeof plantingSettingsSchema>;

export const plantingSettings = defineSettings('planting', plantingSettingsSchema);
