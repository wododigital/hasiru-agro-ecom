import type { JobHandler, SettingsActionResult } from '@ecomkit/core/contracts';
import { enqueue } from '@ecomkit/core/jobs';
import { pushDue } from './outbox';
import { pullInventory } from './pull';

export const PULL_JOB = 'erp-sync.pull-inventory';
export const PUSH_JOB = 'erp-sync.push-outbox';

export const pullInventoryJob: JobHandler<{ force?: boolean }> = async (data, ctx) => {
  const r = await pullInventory({ force: data?.force === true });
  if (r.status === 'failed') throw new Error(`stock pull failed: ${r.error}`);
  if (r.status === 'done') ctx.log.info('erp stock pull', { items: r.items, changed: r.changed, unmapped: r.unmapped, skippedManual: r.skippedManual });
};

export const pushOutboxJob: JobHandler<unknown> = async (_data, ctx) => {
  const r = await pushDue();
  if (r.sent + r.failed + r.dead) ctx.log.info('erp outbox push', { ...r });
};

/** Settings action "Sync now": queues a forced pull on the singleton queue. */
export async function syncNowAction(): Promise<SettingsActionResult> {
  const id = await enqueue(PULL_JOB, { force: true });
  return id ? { ok: true, message: 'Stock sync started. The log updates in a minute.' } : { ok: true, message: 'A stock sync is already queued.' };
}

/** Settings action "Push now": queues an outbox run. */
export async function pushNowAction(): Promise<SettingsActionResult> {
  await enqueue(PUSH_JOB, {});
  return { ok: true, message: 'Outbox push started.' };
}
