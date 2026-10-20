import { randomBytes } from 'node:crypto';
import { env } from '@ecomkit/core/env';
import { defineSettings, getSettings, setSettings } from '@ecomkit/core/settings';
import { feedsSettingsSchema, type FeedsSettings } from '../settings';

export const settingsDef = defineSettings('feeds', feedsSettingsSchema);
export const loadSettings = (): Promise<FeedsSettings> => getSettings(settingsDef);

/** Canonical origin the feed links point at (SITE_URL in production). */
export const feedOrigin = (): string => (env.SITE_URL ?? env.INTERNAL_BASE_URL).replace(/\/$/, '');

/** Replaces the feed token (old URLs stop working at once). 32 random bytes, URL-safe. */
export async function rotateFeedToken(actorId: string | null): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await setSettings(settingsDef, { feedToken: token }, { actorId, actorType: actorId ? 'staff' : 'system' });
  return token;
}
