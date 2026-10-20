import { env } from '@ecomkit/core/env';
import { derivedSecret } from '@ecomkit/core/http';
import { defineSettings, getSettings } from '@ecomkit/core/settings';
import { paymentsSettingsSchema, type PaymentsSettings } from '../settings';

export const settingsDef = defineSettings('payments', paymentsSettingsSchema);
export const loadSettings = (): Promise<PaymentsSettings> => getSettings(settingsDef);

/** Public origin the gateway sends the buyer back to (and where the webhook lives). */
export const publicOrigin = () => (env.SITE_URL ?? env.INTERNAL_BASE_URL).replace(/\/$/, '');

/** Where the server reaches the in-app mock gateway. */
export const mockBase = () => `${env.INTERNAL_BASE_URL.replace(/\/$/, '')}/api/_mock/phonepe`;

export const webhookUrl = () => `${publicOrigin()}/api/webhooks/phonepe`;

/**
 * Webhook credentials. Mock mode without stored values uses a derived pair so local webhooks are still
 * authenticated; sandbox and live without both values reject every webhook (the poll still reconciles).
 */
export function webhookCredentials(s: PaymentsSettings, mode: PaymentsSettings['mode'] = s.mode): { username: string; password: string } | null {
  if (s.webhookUsername && s.webhookPassword) return { username: s.webhookUsername, password: s.webhookPassword };
  if (mode === 'mock') return { username: 'mock', password: derivedSecret('payments-mock-webhook').toString('hex') };
  return null;
}
