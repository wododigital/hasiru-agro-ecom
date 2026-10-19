import { sql } from 'drizzle-orm';
import { fromDrizzle, PgBoss } from 'pg-boss';
import type { JobOptions } from '../contracts';
import { getDbUrl, type Tx } from '../db';

let shared: Promise<PgBoss> | null = null;

/** Schema installs and upgrades need DDL: on in dev and test, off in production (deploy runs `installJobSchema` with the owner URL). */
const migrate = () => process.env.NODE_ENV !== 'production';

function create(options: { worker: boolean; url?: string }): PgBoss {
  const boss = new PgBoss({
    connectionString: options.url ?? getDbUrl(),
    migrate: migrate(),
    supervise: options.worker,
    schedule: options.worker,
    max: options.worker ? 10 : 3,
  });
  boss.on('error', (err) => process.stderr.write(`${JSON.stringify({ level: 'error', scope: 'jobs', message: String(err) })}\n`));
  return boss;
}

/** Producer instance for the web process (no supervision, no cron). The worker swaps in its own via `setSharedBoss`. */
export function getBoss(): Promise<PgBoss> {
  shared ??= create({ worker: false }).start();
  return shared;
}

export function createWorkerBoss(): PgBoss {
  return create({ worker: true });
}

export function setSharedBoss(boss: PgBoss | null): void {
  shared = boss ? Promise.resolve(boss) : null;
}

/** Stops the producer instance (tests, scripts). */
export async function stopBoss(): Promise<void> {
  const pending = shared;
  shared = null;
  if (pending) await (await pending).stop({ graceful: false });
}

/** Installs or upgrades the job queue schema with the owner role (deploy step). */
export async function installJobSchema(ownerUrl: string): Promise<void> {
  const boss = new PgBoss({ connectionString: ownerUrl, migrate: true, supervise: false, schedule: false });
  await boss.start();
  await boss.stop({ graceful: false });
}

export const txDb = (tx: Tx) => fromDrizzle(tx, sql);

/**
 * ponytail: createQueue never changes an existing queue, so a changed retry policy only reaches new
 * queues; call boss.updateQueue from a deploy step if a policy must change on a live queue.
 * Contract defaults: retry 5 times, 30 s apart with exponential backoff capped at 1 h, then the `<name>.dead` queue. */
export async function ensureQueue(boss: PgBoss, name: string, options: JobOptions = {}): Promise<void> {
  const deadLetter = options.deadLetter === false ? undefined : `${name}.dead`;
  if (deadLetter) await boss.createQueue(deadLetter, { policy: 'standard' });
  const backoff = options.retryBackoff ?? true;
  await boss.createQueue(name, {
    policy: options.policy ?? 'standard',
    retryLimit: options.retryLimit ?? 5,
    retryDelay: options.retryDelaySec ?? 30,
    retryBackoff: backoff,
    ...(backoff ? { retryDelayMax: options.retryDelayMaxSec ?? 3600 } : {}),
    ...(options.expireInSec ? { expireInSeconds: options.expireInSec } : {}),
    ...(deadLetter ? { deadLetter } : {}),
  });
}
