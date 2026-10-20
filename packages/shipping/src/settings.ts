import { z } from 'zod';
import { defineSettings } from '@ecomkit/core/settings';

// Scalar knobs only. Zones, methods, vehicles, slots, packing rules and distances are rows, edited in the
// Delivery panel (settings.customPanel) under this form.
export const shippingSettingsSchema = z.object({
  blackout_dates: z
    .string()
    .max(2000)
    .default('')
    .meta({ group: 'Slot calendar', help: 'Dates with no local delivery (holidays), YYYY-MM-DD separated by commas.', placeholder: '2026-11-08, 2026-12-25' }),
  delivery_check_rate_per_min: z
    .number()
    .int()
    .min(5)
    .max(600)
    .default(30)
    .meta({ group: 'Delivery check', help: 'Delivery-check lookups allowed per visitor per minute.' }),
});
export type ShippingSettings = z.infer<typeof shippingSettingsSchema>;

export const shippingSettings = defineSettings('shipping', shippingSettingsSchema);
