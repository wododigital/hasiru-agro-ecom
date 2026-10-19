import type { JobHandler } from '@ecomkit/core/contracts';
import { db } from '@ecomkit/core/db';
import { sql } from 'drizzle-orm';
import { isPartitionExpired, PARTITION_NAME_RE, partitionsToEnsure, RETENTION_DAYS } from '../domain/time';

export interface PartitionChanges {
  created: string[];
  dropped: string[];
  /** Rows deleted from the DEFAULT partition because they are past retention. */
  prunedDefaultRows: number;
}

/** Month partitions currently attached to analytics_event. */
export async function listPartitions(): Promise<string[]> {
  const { rows } = await db.execute<{ name: string }>(sql`
    select c.relname as name from pg_inherits i
    join pg_class c on c.oid = i.inhrelid
    where i.inhparent = to_regclass('analytics_event')
    order by 1`);
  return rows.map((r) => r.name);
}

/**
 * Makes sure the current month and the next two have partitions, drops month partitions whose rows are all past
 * retention (90 days), and prunes old rows that landed in DEFAULT. A missing month is created detached, filled
 * with any rows DEFAULT already holds for it, and then attached, so a busy DEFAULT never blocks the job.
 */
export async function ensurePartitions(now: Date = new Date()): Promise<PartitionChanges> {
  const existing = new Set(await listPartitions());
  const changes: PartitionChanges = { created: [], dropped: [], prunedDefaultRows: 0 };

  for (const p of partitionsToEnsure(now)) {
    if (existing.has(p.name)) continue;
    const name = sql.identifier(p.name);
    const from = p.from.toISOString();
    const to = p.to.toISOString();
    await db.transaction(async (tx) => {
      await tx.execute(sql`create table ${name} (like analytics_event including defaults)`);
      if (existing.has('analytics_event_default')) {
        await tx.execute(sql`
          with moved as (delete from analytics_event_default where server_ts >= ${from}::timestamptz and server_ts < ${to}::timestamptz returning *)
          insert into ${name} select * from moved`);
      }
      await tx.execute(sql`alter table analytics_event attach partition ${name} for values from (${sql.raw(`'${from}'`)}) to (${sql.raw(`'${to}'`)})`);
    });
    changes.created.push(p.name);
  }

  for (const name of existing) {
    if (PARTITION_NAME_RE.test(name) && isPartitionExpired(name, now)) {
      await db.execute(sql`drop table if exists ${sql.identifier(name)}`);
      changes.dropped.push(name);
    }
  }

  if (existing.has('analytics_event_default')) {
    const res = await db.execute(
      sql`delete from analytics_event_default where server_ts < ${now.toISOString()}::timestamptz - make_interval(days => ${RETENTION_DAYS})`,
    );
    changes.prunedDefaultRows = res.rowCount ?? 0;
  }
  return changes;
}

/** analytics.create-partition (25th of each month). */
export const createPartitionJob: JobHandler<unknown> = async (_data, ctx) => {
  const changes = await ensurePartitions();
  ctx.log.info('analytics partitions', { ...changes });
};
