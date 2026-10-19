// Test helpers. Import only from tests: they create and drop databases.
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { dropDatabase, freshDatabase } from '@tooling/scripts/db';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { closeDb, configureDb, type Db } from '../db';
import { resetEnv } from '../env';
import { resetEventQueue } from '../events';
import { stopBoss } from '../jobs/boss';

export * from './fakes';

const run = promisify(execFile);

export interface TestDb {
  url: string;
  db: Db;
  pool: Pool;
  /** Stops the job producer, closes the pool and drops the database. */
  close(): Promise<void>;
}

/**
 * Fresh `ecomkit_<name>` database cloned from the template, with the given packages' schemas pushed
 * (drizzle-kit push through @tooling/scripts), and the shared `db` pointed at it.
 * Use one name per test file: vitest runs files in parallel.
 */
export async function createTestDb(name: string, options: { schemas?: readonly string[] } = {}): Promise<TestDb> {
  const url = await freshDatabase(name);
  const schemas = options.schemas ?? ['core'];
  if (schemas.length) {
    const cwd = dirname(fileURLToPath(import.meta.resolve('@tooling/scripts/db')));
    await run(join(cwd, 'node_modules', '.bin', 'drizzle-kit'), ['push', '--force', '--config', 'drizzle.config.ts'], {
      cwd,
      env: { ...process.env, DATABASE_URL: url, ECOMKIT_SCHEMA: schemas.join(',') },
    });
  }
  process.env.DATABASE_URL = url;
  resetEnv();
  resetEventQueue();
  const { db, pool } = configureDb(url, { max: 20 });
  return {
    url,
    db,
    pool,
    async close() {
      await stopBoss();
      await closeDb();
      await dropDatabase(name);
    },
  };
}

/** Rows every store needs before its first order: the order sequence. */
export async function seedMinimal(db: Db): Promise<void> {
  await db.execute(sql`insert into core_sequence (name, value) values ('order', 0) on conflict do nothing`);
}

/** The fixed instant tests use for anything time-based: 2026-10-20 10:00 IST. */
export const TEST_NOW = new Date('2026-10-20T10:00:00+05:30');

/** A controllable clock for code that takes `now`. */
export function fixedClock(start: Date = TEST_NOW): { now(): Date; advance(ms: number): void } {
  let t = start.getTime();
  return { now: () => new Date(t), advance: (ms) => void (t += ms) };
}

export type QueuedJob = {
  id: string;
  name: string;
  data: unknown;
  state: string;
};

/** Jobs written to the queue (outbox), optionally for one queue name. Reads the pg-boss table directly. */
export async function queuedJobs(db: Db, name?: string): Promise<QueuedJob[]> {
  const installed = await db.execute<{ t: string | null }>(sql`select to_regclass('pgboss.job')::text as t`);
  if (!installed.rows[0]?.t) return [];
  const where = name ? sql`where name = ${name}` : sql``;
  const { rows } = await db.execute<QueuedJob>(sql`select id, name, data, state from pgboss.job ${where} order by created_on, id`);
  return rows;
}
