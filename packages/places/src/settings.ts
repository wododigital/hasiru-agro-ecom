import { z } from 'zod';
import { defineSettings } from '@ecomkit/core/settings';

export const placesSettingsSchema = z.object({
  pincode_lookup: z
    .boolean()
    .default(true)
    .meta({ group: 'Pincodes', help: 'Fill district and state from a pincode at checkout. Switched off automatically when no pincode directory is loaded.' }),
  suggest_limit: z.number().int().min(3).max(12).default(6).meta({ group: 'Search', help: 'How many district suggestions the typeahead shows.' }),
});
export type PlacesSettings = z.infer<typeof placesSettingsSchema>;

export const placesSettings = defineSettings('places', placesSettingsSchema);
