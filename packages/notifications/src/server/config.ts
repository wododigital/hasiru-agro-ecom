import { createHmac } from 'node:crypto';
import { env } from '@ecomkit/core/env';
import { derivedSecret, safeFetch } from '@ecomkit/core/http';
import { normalisePhone } from '@ecomkit/core/ids';
import { defineSettings, getSettings, getSettingsForAdmin, setSettings, type SetSettingsContext } from '@ecomkit/core/settings';
import { z } from 'zod';
import { notificationsSettingsSchema, type NotificationsSettings } from '../settings';

export const settingsDef = defineSettings('notifications', notificationsSettingsSchema);
export const loadSettings = (): Promise<NotificationsSettings> => getSettings(settingsDef);

/**
 * Partial settings update. core `setSettings` parses the patch with `schema.partial()`, and zod 4 fills defaults
 * for absent keys there, so a bare patch would reset every other stored field to its default. Merging the stored
 * plain values first keeps them. (Cross-package request to core: drop keys absent from the patch after parsing.)
 */
export async function updateSettings(patch: Partial<Record<keyof NotificationsSettings, unknown>>, ctx: SetSettingsContext): Promise<void> {
  const { values } = await getSettingsForAdmin(settingsDef);
  await setSettings(settingsDef, { ...values, ...patch }, ctx);
}

/** Agency OAuth client shared across stores; a store may override it in settings. */
const oauthEnv = z.object({ GMAIL_OAUTH_CLIENT_ID: z.string().optional(), GMAIL_OAUTH_CLIENT_SECRET: z.string().optional() });
export function gmailClient(s: NotificationsSettings): { id: string; secret: string } | null {
  const e = oauthEnv.parse(process.env);
  const id = s.gmailClientId || e.GMAIL_OAUTH_CLIENT_ID || '';
  const secret = s.gmailClientSecret || e.GMAIL_OAUTH_CLIENT_SECRET || '';
  return id && secret ? { id, secret } : null;
}

export type Http = (url: string, init: { method?: string; headers?: Record<string, string>; body?: string | URLSearchParams }) => Promise<Response>;

/**
 * Outbound HTTP for a provider. Live and sandbox go through the SSRF-guarded `safeFetch` with the provider's
 * host allowlist; mock mode talks to the in-app mock routes over plain HTTP on INTERNAL_BASE_URL.
 */
export function providerHttp(mode: string, allowHosts: readonly string[]): Http {
  if (mode === 'mock') return (url, init) => fetch(url, init);
  return (url, init) => safeFetch(url, init, { allowHosts, timeoutMs: 15_000 });
}

export const mockBase = (provider: 'meta' | 'gmail') => `${env.INTERNAL_BASE_URL.replace(/\/$/, '')}/api/_mock/${provider}`;

/** Public origin for links Meta and Google call back to (webhook URL, OAuth redirect). */
export const publicOrigin = () => (env.SITE_URL ?? env.INTERNAL_BASE_URL).replace(/\/$/, '');

/** Keyed hash of an address (normalised phone or lower-cased email): what the log, opt-outs and window checks match on. */
export function addressHash(address: string): string {
  const key = address.includes('@') ? address.trim().toLowerCase() : (normalisePhone(address) ?? `+${address.replace(/\D/g, '')}`);
  return createHmac('sha256', derivedSecret('notifications-address')).update(key).digest('base64url').slice(0, 32);
}
