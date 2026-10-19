// What the host binds at boot: the registry (health checks from every enabled module, the notifications service)
// and the webhook transport. Unbound, monitoring still runs its own checks and alerts through the webhook and the bell.
import { statfs } from 'node:fs/promises';
import type { NotificationSender } from '@ecomkit/core/contracts';
import { safeFetch } from '@ecomkit/core/http';
import type { Registry } from '@ecomkit/core/manifest';

export type WebhookPoster = (url: string, payload: Record<string, unknown>) => Promise<{ ok: boolean; status: number }>;

export interface MonitoringRuntime {
  registry: Registry | null;
  /** Defaults to `registry.service('notifications')`. */
  notifications: () => Promise<NotificationSender | null>;
  postWebhook: WebhookPoster;
  /** Free and total bytes of the filesystem holding `path` (tests swap it: the build machine's disk is not the subject). */
  statDisk: (path: string) => Promise<{ freeBytes: number; totalBytes: number }>;
}

const defaultPost: WebhookPoster = async (url, payload) => {
  const res = await safeFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }, { timeoutMs: 8000, maxBytes: 64 * 1024 });
  return { ok: res.ok, status: res.status };
};

const runtime: MonitoringRuntime = {
  registry: null,
  notifications: async () => (runtime.registry ? runtime.registry.service('notifications') : null),
  postWebhook: defaultPost,
  statDisk: async (path) => {
    const s = await statfs(path);
    return { freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize };
  },
};

/**
 * Call once in the web process (instrumentation register) and in the worker:
 * `configureMonitoring({ registry })`. Tests pass fakes for `notifications` and `postWebhook`.
 */
export function configureMonitoring(next: Partial<MonitoringRuntime>): void {
  Object.assign(runtime, next);
}

export function getRuntime(): Readonly<MonitoringRuntime> {
  return runtime;
}
