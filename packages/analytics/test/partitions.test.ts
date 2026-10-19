import { randomUUID } from 'node:crypto';
import type { TestDb } from '@ecomkit/core/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { partitionsToEnsure } from '../src/domain/time';
import { ensurePartitions, listPartitions } from '../src/server/partitions';
import { analyticsDb, PARTITIONS_SQL } from './helpers';

let t: TestDb;

beforeAll(async () => {
  t = await analyticsDb('wp-12-partitions');
});
afterAll(async () => {
  await t?.close();
});

async function insertAt(serverTs: string): Promise<void> {
  await t.db.execute(sql`insert into analytics_event (client_event_id, session_id, visitor_id, name, path, server_ts)
    values (${randomUUID()}, ${randomUUID()}, ${randomUUID()}, 'page_view', '/', ${serverTs}::timestamptz)`);
}

describe('partitions.sql', () => {
  it('turns the pushed plain table into a range-partitioned parent with this month, the next two and DEFAULT', async () => {
    const { rows } = await t.db.execute<{ kind: string }>(sql`select relkind::text as kind from pg_class where oid = to_regclass('analytics_event')`);
    expect(rows[0]?.kind).toBe('p');
    const names = await listPartitions();
    for (const p of partitionsToEnsure(new Date())) expect(names).toContain(p.name);
    expect(names).toContain('analytics_event_default');
  });

  it('is idempotent and keeps the unique (client_event_id, server_ts) key across partitions', async () => {
    await t.pool.query(PARTITIONS_SQL);
    const id = randomUUID();
    const ts = new Date().toISOString();
    await t.db.execute(sql`insert into analytics_event (client_event_id, session_id, visitor_id, name, path, server_ts) values (${id}, ${randomUUID()}, ${randomUUID()}, 'page_view', '/', ${ts}::timestamptz)`);
    await expect(
      t.db.execute(sql`insert into analytics_event (client_event_id, session_id, visitor_id, name, path, server_ts) values (${id}, ${randomUUID()}, ${randomUUID()}, 'page_view', '/', ${ts}::timestamptz)`),
    ).rejects.toThrow();
  });
});

describe('analytics.create-partition', () => {
  it('creates month+2 and drops month-4 (past 90 days), keeping month-3', async () => {
    // Build history: a job run in June leaves June, July and August.
    const june = await ensurePartitions(new Date('2026-06-25T02:00:00+05:30'));
    expect(june.created).toEqual(expect.arrayContaining(['analytics_event_2026_06', 'analytics_event_2026_07', 'analytics_event_2026_08']));
    await insertAt('2026-06-10T00:00:00Z');

    const run = await ensurePartitions(new Date('2026-10-25T02:00:00+05:30'));
    const names = await listPartitions();
    expect(names).toContain('analytics_event_2026_12'); // month+2
    expect(run.dropped).toContain('analytics_event_2026_06'); // month-4
    expect(names).not.toContain('analytics_event_2026_06');
    expect(names).toContain('analytics_event_2026_07'); // month-3 still inside 90 days
    const left = await t.db.execute<{ n: number }>(sql`select count(*)::int as n from analytics_event where server_ts < '2026-07-01T00:00:00Z'`);
    expect(left.rows[0]?.n).toBe(0);
  });

  it('creates a far month that DEFAULT already holds rows for, moving those rows in', async () => {
    await insertAt('2027-05-03T00:00:00Z'); // lands in DEFAULT
    const run = await ensurePartitions(new Date('2027-03-25T02:00:00+05:30'));
    expect(run.created).toContain('analytics_event_2027_05');
    const inDefault = await t.db.execute<{ n: number }>(sql`select count(*)::int as n from analytics_event_default where server_ts >= '2027-05-01T00:00:00Z'`);
    const inMonth = await t.db.execute<{ n: number }>(sql`select count(*)::int as n from analytics_event_2027_05`);
    expect(inDefault.rows[0]?.n).toBe(0);
    expect(inMonth.rows[0]?.n).toBe(1);
    expect(run.dropped).toEqual(expect.arrayContaining(['analytics_event_2026_07', 'analytics_event_2026_11']));
    expect(await listPartitions()).toContain('analytics_event_2026_12');
  });

  it('prunes DEFAULT rows past retention', async () => {
    await insertAt('2020-01-01T00:00:00Z');
    const run = await ensurePartitions(new Date('2027-03-25T02:00:00+05:30'));
    expect(run.prunedDefaultRows).toBeGreaterThanOrEqual(1);
    expect(run.created).toEqual([]);
  });
});
