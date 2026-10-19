import { randomBytes } from 'node:crypto';
import type { ChannelId, NotificationSender, TemplateKey } from '@ecomkit/core/contracts';
import { setSettings } from '@ecomkit/core/settings';
import { createTestDb, type TestDb } from '@ecomkit/core/testing';
import { configureMonitoring } from '../src/server/runtime';
import { monitoringSettingsDef } from '../src/server/settings';

/** Own database per test file (vitest runs files in parallel): ecomkit_wp_11_<suffix>. */
export async function monitoringDb(suffix: string): Promise<TestDb> {
  process.env.INTERNAL_SECRET ??= 'm'.repeat(40);
  process.env.SETTINGS_MASTER_KEY ??= `1:${randomBytes(32).toString('base64')}`;
  return createTestDb(`wp-11-${suffix}`, { schemas: ['core', 'monitoring'] });
}

export const WEBHOOK = 'https://hooks.example.test/alerts';

export async function configureRecipients(patch: Record<string, unknown> = {}): Promise<void> {
  await setSettings(monitoringSettingsDef, { devEmail: 'dev@example.test', devPhone: '+919800000001', fallbackWebhookUrl: WEBHOOK, ...patch }, { actorId: null, actorType: 'system' });
}

export interface Sent {
  templateKey: TemplateKey;
  channel: ChannelId | undefined;
  to: string;
  vars: Readonly<Record<string, string | number>>;
}

/**
 * Fake notifications service and webhook, wired into the monitoring runtime.
 * `mode`: 'ok' sends, 'throw' fails every send, 'empty' returns no message ids (skipped by the service).
 */
export function fakeTransports() {
  const state = { mode: 'ok' as 'ok' | 'throw' | 'empty', available: true, webhookOk: true, sent: [] as Sent[], webhook: [] as Record<string, unknown>[], urls: [] as string[], diskFree: 0.5 };
  const sender: NotificationSender = {
    async send(templateKey, to, vars, options) {
      if (state.mode === 'throw') throw new Error('provider down');
      if (state.mode === 'empty') return { messageIds: [] };
      state.sent.push({ templateKey, channel: options?.channel, to: to.email ?? to.phone ?? '', vars });
      return { messageIds: [`m${state.sent.length}`] };
    },
  };
  configureMonitoring({
    registry: null,
    notifications: async () => (state.available ? sender : null),
    // The build machine's disk is not under test: plenty of space unless a test says otherwise.
    statDisk: async () => ({ freeBytes: state.diskFree * 1000, totalBytes: 1000 }),
    postWebhook: async (url, payload) => {
      state.urls.push(url);
      state.webhook.push(payload);
      return { ok: state.webhookOk, status: state.webhookOk ? 200 : 500 };
    },
  });
  return {
    state,
    reset() {
      state.mode = 'ok';
      state.available = true;
      state.webhookOk = true;
      state.sent.length = 0;
      state.webhook.length = 0;
      state.urls.length = 0;
      state.diskFree = 0.5;
    },
  };
}

export const minutes = (n: number) => n * 60_000;
export const at = (base: Date, ms: number) => new Date(base.getTime() + ms);
