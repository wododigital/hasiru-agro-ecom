// Settings schema. Kept outside server/ so the manifest can import it without pulling server code.
import { z } from 'zod';
import { HHMM_RE } from './domain/rules';

const text = (group: string, help?: string, placeholder?: string) => z.string().trim().max(500).default('').meta({ group, help, placeholder });
const secret = (group: string, help?: string) => z.string().max(4000).optional().meta({ secret: true, group, help });

export const notificationsSettingsSchema = z.object({
  storeName: text('General', 'Shown in every message as {{store_name}}.', 'Store name'),
  adminEmail: z.union([z.literal(''), z.email()]).default('').meta({ group: 'General', help: 'Receives admin notices (new enquiries, alerts) and test emails.' }),
  adminPhone: text('General', 'WhatsApp number for admin notices and test messages, with country code.', '+91…'),
  quietHoursStart: z.string().regex(HHMM_RE).default('21:00').meta({ group: 'General', help: 'Marketing messages wait until quiet hours end (IST). Order updates and codes always go.' }),
  quietHoursEnd: z.string().regex(HHMM_RE).default('09:00').meta({ group: 'General' }),
  otpKillSwitch: z.boolean().default(false).meta({ group: 'General', help: 'Stops every sign-in and verification code. Customers cannot sign in by code while this is on.' }),

  emailMode: z.enum(['off', 'mock', 'live']).default('mock').meta({ group: 'Email', help: 'Gmail API over OAuth. Mock sends to the dev outbox.' }),
  gmailClientId: text('Email', 'Leave blank to use the agency OAuth client from the server environment.'),
  gmailClientSecret: secret('Email', 'Leave blank to use the server environment.'),
  gmailRefreshToken: secret('Email', 'Set by Connect Gmail. Never shown.'),
  gmailAccount: text('Email', 'The connected mailbox. Set by Connect Gmail.'),
  emailFromName: text('Email', 'Sender name.'),
  emailReplyTo: z.union([z.literal(''), z.email()]).default('').meta({ group: 'Email' }),
  emailBccAdmin: z.boolean().default(false).meta({ group: 'Email', help: 'Copy the admin email on every customer email.' }),

  whatsappMode: z.enum(['off', 'mock', 'sandbox', 'live']).default('mock').meta({ group: 'WhatsApp', help: 'Meta WhatsApp Cloud API. Mock answers locally.' }),
  whatsappGraphVersion: z.string().regex(/^v\d+\.\d+$/).default('v26.0').meta({ group: 'WhatsApp' }),
  whatsappWabaId: text('WhatsApp', 'WhatsApp Business Account ID.'),
  whatsappPhoneNumberId: text('WhatsApp', 'Phone number ID (not the phone number).'),
  whatsappAppId: text('WhatsApp', 'Meta app ID.'),
  whatsappAppSecret: secret('WhatsApp', 'Verifies webhook signatures.'),
  whatsappToken: secret('WhatsApp', 'System user access token.'),
  whatsappVerifyToken: secret('WhatsApp', 'Webhook verify token. Enter the same value in the Meta app webhook settings.'),
  whatsappLanguage: z.string().regex(/^[a-z]{2}(_[A-Z]{2})?$/).default('en').meta({ group: 'WhatsApp', help: 'Template language code.' }),
  whatsappMarketingViaMmApi: z.boolean().default(true).meta({ group: 'WhatsApp', help: 'Send marketing templates through the Marketing Messages API (required for new accounts).' }),

  smsMode: z.enum(['off', 'mock']).default('mock').meta({ group: 'SMS', help: 'Only a log adapter exists until sender registration is done.' }),
});

export type NotificationsSettings = z.infer<typeof notificationsSettingsSchema>;
