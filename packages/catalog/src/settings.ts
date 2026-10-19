import { z } from 'zod';

/** Catalog settings (rendered by admin-shell at /admin/settings/catalog). Zod only, so the manifest stays light. */
export const catalogSettingsSchema = z.object({
  whatsappNumber: z
    .string()
    .regex(/^\d{10,15}$/)
    .optional()
    .meta({ group: 'Storefront', help: 'Digits with the country code (for example 919800000000). Shows "Ask on WhatsApp" on product pages.', placeholder: '919800000000' }),
  pageSize: z.number().int().min(12).max(96).default(24).meta({ group: 'Storefront', help: 'Products per listing page.' }),
});
export type CatalogSettings = z.infer<typeof catalogSettingsSchema>;
