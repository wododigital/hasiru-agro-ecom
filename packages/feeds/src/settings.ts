// Settings schema. Kept outside server/ so the manifest can import it without pulling server code.
// Text fields coerce: a digits-only value can come back from core_settings (jsonb) as a number.
import { z } from 'zod';

export const feedsSettingsSchema = z.object({
  feedToken: z.coerce.string().max(200).optional().meta({ secret: true, group: 'Access', help: 'Secret in the feed URLs. Use "Generate new feed token" (the old URLs stop working).' }),
  googleEnabled: z.boolean().default(true).meta({ group: 'Google Merchant Center', help: 'Serve /feeds/google.xml for a scheduled fetch in Merchant Center.' }),
  metaEnabled: z.boolean().default(true).meta({ group: 'Meta catalog', help: 'Serve /feeds/meta.csv for a scheduled data source in Commerce Manager.' }),
  brand: z.coerce.string().trim().max(70).default('').meta({ group: 'Product data', help: 'Brand sent with every item (required by both platforms for new products).', placeholder: 'Store brand' }),
  googleCategoryPlant: z.coerce.string().trim().max(250).default('').meta({ group: 'Product data', help: 'Google product category for plants (name or numeric id).', placeholder: 'Home & Garden > Plants' }),
  googleCategoryInput: z.coerce.string().trim().max(250).default('').meta({ group: 'Product data', help: 'Google product category for inputs (name or numeric id).' }),
  includeOutOfStock: z.boolean().default(true).meta({ group: 'Product data', help: 'List out-of-stock items as out of stock (recommended) instead of leaving them out.' }),
  debounceSec: z.number().int().min(10).max(3600).default(120).meta({ group: 'Schedule', help: 'Wait this long after a product, price or stock change before rebuilding, so a bulk edit rebuilds once.' }),
});

export type FeedsSettings = z.infer<typeof feedsSettingsSchema>;
