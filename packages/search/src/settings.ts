import { z } from 'zod';

/** Admin settings (rendered by admin-shell on /admin/settings/search). Empty links hide their CTA. */
export const searchSettingsSchema = z.object({
  assistanceUrl: z
    .union([z.url({ protocol: /^https$/ }), z.literal('')])
    .default('')
    .meta({ group: 'Zero results', help: 'Chat link offered when nothing matches, e.g. a WhatsApp click-to-chat URL.', placeholder: 'https://wa.me/91XXXXXXXXXX' }),
  guidedHref: z
    .union([z.string().regex(/^\/[a-z0-9/_-]*$/), z.literal('')])
    .default('')
    .meta({ group: 'Zero results', help: 'Store path of a guided chooser, e.g. /plan.', placeholder: '/plan' }),
  logQueries: z.boolean().default(true).meta({ group: 'Insights', help: 'Record searches and zero-result filter combinations (no personal data).' }),
});

export type SearchSettings = z.infer<typeof searchSettingsSchema>;
