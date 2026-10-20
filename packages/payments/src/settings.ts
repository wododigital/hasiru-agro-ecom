// Settings schema. Kept outside server/ so the manifest can import it without pulling server code.
import { z } from 'zod';

const text = (group: string, help?: string, placeholder?: string) => z.string().trim().max(500).default('').meta({ group, help, placeholder });
const secret = (group: string, help?: string) => z.string().max(4000).optional().meta({ secret: true, group, help });

export const paymentsSettingsSchema = z.object({
  mode: z.enum(['mock', 'sandbox', 'live']).default('mock').meta({ group: 'Gateway', help: 'Mock answers locally with a test pay page. Sandbox uses the gateway test environment.' }),
  merchantId: text('Gateway', 'Merchant ID from the gateway dashboard.'),
  clientId: text('Gateway', 'Client ID (separate values for sandbox and live).'),
  clientSecret: secret('Gateway', 'Client secret. Never shown after saving.'),
  clientVersion: z.string().trim().regex(/^\d{1,4}$/).default('1').meta({ group: 'Gateway', help: 'Client version issued with the client ID.' }),
  webhookUsername: text('Webhook', 'Choose a username and enter the same one on the gateway dashboard.'),
  webhookPassword: secret('Webhook', 'Choose a password and enter the same one on the gateway dashboard.'),

  attemptExpiryMinutes: z.coerce.number().int().min(5).max(60).default(15).meta({
    group: 'Checkout',
    help: 'How long a buyer has to pay. Stock stays held for the same time; unpaid orders are cancelled after it.',
  }),
  codMode: z.enum(['online_only', 'partial_advance']).default('online_only').meta({
    group: 'Checkout',
    help: 'Partial advance: the buyer pays a share online and the balance on delivery.',
  }),
  advancePercent: z.coerce.number().int().min(10).max(90).default(30).meta({ group: 'Checkout', help: 'Share paid online in partial advance mode.' }),
  payAtPickup: z.boolean().default(false).meta({ group: 'Checkout', help: 'Allow paying at the store when the buyer collects the order.' }),
  bankTransfer: z.boolean().default(false).meta({ group: 'Checkout', help: 'Offer bank transfer. Staff mark the payment received from the payments page.' }),
  bankTransferHours: z.coerce.number().int().min(1).max(168).default(48).meta({ group: 'Checkout', help: 'Hours a bank transfer order stays open (stock held) before it is cancelled.' }),
  bankTransferNote: z.string().trim().max(1000).default('').meta({ group: 'Checkout', help: 'Account details shown to the buyer after placing a bank transfer order.' }),
});

export type PaymentsSettings = z.infer<typeof paymentsSettingsSchema>;
