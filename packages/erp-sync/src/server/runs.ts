import { db } from '@ecomkit/core/db';
import { desc } from 'drizzle-orm';
import { erpSyncRun } from '../schema';

export async function listRuns(limit = 30): Promise<(typeof erpSyncRun.$inferSelect)[]> {
  return db.select().from(erpSyncRun).orderBy(desc(erpSyncRun.startedAt), desc(erpSyncRun.id)).limit(Math.min(limit, 200));
}
