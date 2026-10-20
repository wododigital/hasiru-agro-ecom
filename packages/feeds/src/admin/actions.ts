'use server';

import { requirePermission } from '@ecomkit/core/auth-context';
import { redirect } from 'next/navigation';
import { regenerateFeeds } from '../server/generate';

export async function rebuildFeedsAction(): Promise<void> {
  await requirePermission('marketing.write');
  const reports = await regenerateFeeds({ force: true });
  redirect(`/admin/marketing/feeds?rebuilt=${reports.length}`);
}
