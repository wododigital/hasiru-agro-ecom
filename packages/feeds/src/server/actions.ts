import type { SettingsActionResult } from '@ecomkit/core/contracts';
import { rotateFeedToken } from './config';
import { regenerateFeeds } from './generate';

/** Settings action "Rebuild feeds now". */
export async function regenerateAction(): Promise<SettingsActionResult> {
  const reports = await regenerateFeeds({ force: true });
  if (!reports.length) return { ok: false, message: 'Both feeds are switched off.' };
  return { ok: true, message: reports.map((r) => `${r.destination}: ${r.items} items, ${r.errors} with errors`).join('. '), detail: { reports: reports.map(({ issues: _i, ...r }) => r) } };
}

/** Settings action "Generate new feed token". */
export async function rotateTokenAction(ctx: { actorId: string }): Promise<SettingsActionResult> {
  await rotateFeedToken(ctx.actorId);
  return { ok: true, message: 'New feed token saved. Update the feed URLs in Merchant Center and Commerce Manager.' };
}
