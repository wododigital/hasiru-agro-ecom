import type { HealthResult } from '@ecomkit/core/contracts';
import { outboxCounts } from './outbox';
import { resolveAdapter } from './ports';
import { lastGoodPull } from './pull';
import { loadSettings } from './settings';

/** Stock pull age: degraded once three intervals pass without a clean pull. */
export async function pullAgeHealth(now = Date.now()): Promise<HealthResult> {
  const [settings, adapter] = await Promise.all([loadSettings(), resolveAdapter()]);
  if (!adapter || !settings.enabled) return { status: 'not_configured', detail: !adapter ? 'No ERP adapter configured.' : 'ERP sync is switched off.' };
  const last = await lastGoodPull();
  if (!last) return { status: 'degraded', detail: 'No successful stock pull yet.' };
  const minutes = Math.round((now - last.startedAt.getTime()) / 60_000);
  return minutes > settings.pullEveryMinutes * 3 ? { status: 'degraded', detail: `Last good stock pull ${minutes} min ago.` } : { status: 'ok', detail: `Last good stock pull ${minutes} min ago.` };
}

/** Dead-letter rows: critical, so monitoring raises an alert. */
export async function outboxHealth(): Promise<HealthResult> {
  const c = await outboxCounts();
  if (c.dead > 0) return { status: 'down', detail: `${c.dead} push(es) in dead letter. Retry them from ERP sync.` };
  return { status: 'ok', detail: `${c.waitingOrders} order(s) and ${c.waitingLeads} lead(s) waiting.` };
}
