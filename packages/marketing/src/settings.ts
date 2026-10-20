// Settings schema. Kept outside server/ so the manifest can import it without pulling server code.
// Text fields use `z.coerce.string()`: core_settings is jsonb and drizzle's jsonb reader parses a stored string a
// second time, so a digits-only id ("123456789012") comes back as a number (cross-package request to core in
// BUILD-STATUS/wp-23.md). Coercion keeps the field a plain text input in the admin settings form; empty = off.
import { z } from 'zod';

const id = (re: RegExp, group: string, help: string, placeholder: string) => z.coerce.string().trim().regex(re).default('').meta({ group, help, placeholder });
const secret = (group: string, help: string) => z.coerce.string().max(4000).optional().meta({ secret: true, group, help });
const mode = (group: string) => z.enum(['off', 'mock', 'live']).default('mock').meta({ group, help: 'Server-side sends. Mock posts to the local mock endpoint; off sends nothing.' });

export const marketingSettingsSchema = z.object({
  consentBanner: z.boolean().default(true).meta({ group: 'Consent', help: 'Show the cookie choice banner. Tags that need consent never load without a choice.' }),

  ga4MeasurementId: id(/^(G-[A-Z0-9]{4,20})?$/, 'Google Analytics 4', 'Web data stream measurement ID. Empty disables GA4.', 'G-XXXXXXXXXX'),
  ga4ApiSecret: secret('Google Analytics 4', 'Measurement Protocol API secret, for purchase and refund sent from the server.'),
  ga4Mode: mode('Google Analytics 4'),

  metaPixelId: id(/^(\d{6,20})?$/, 'Meta', 'Pixel (dataset) ID. Empty disables the pixel and the Conversions API.', '123456789012345'),
  metaCapiToken: secret('Meta', 'Conversions API access token (Events Manager > Settings).'),
  metaTestEventCode: id(/^[A-Za-z0-9]{0,50}$/, 'Meta', 'Test event code for Events Manager while checking the setup. Clear it before launch.', 'TEST12345'),
  metaGraphVersion: z.string().regex(/^v\d+\.\d+$/).default('v26.0').meta({ group: 'Meta' }),
  metaMode: mode('Meta'),

  adsConversionId: id(/^(AW-\d{6,15})?$/, 'Google Ads', 'Conversion ID. Empty disables the Ads tag.', 'AW-123456789'),
  adsPurchaseLabel: id(/^[A-Za-z0-9_-]{0,64}$/, 'Google Ads', 'Conversion label of the purchase action.', 'AbCdEfGh'),
  adsEnhancedConversions: z.boolean().default(false).meta({ group: 'Google Ads', help: 'Send the buyer email and phone with the purchase conversion (Google hashes them). Only with marketing consent.' }),
});

export type MarketingSettings = z.infer<typeof marketingSettingsSchema>;
