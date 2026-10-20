import { hostname } from 'node:os';
import { sql } from 'drizzle-orm';
import type { JobDef, JobHandler, JobOptions, Lazy } from '../contracts';
import { db, upsertRequireUpdate, type Tx } from '../db';
import { startEventRouting } from '../events';
import type { Registry } from '../manifest';
import { createLogger } from '../observability';
import { coreJobHeartbeat } from '../schema';
import { createWorkerBoss, ensureQueue, getBoss, txDb, setSharedBoss } from './boss';

export { ensureQueue, getBoss, installJobSchema, stopBoss } from './boss';
export type { JobContext, JobDef, JobHandler, JobOptions, ScheduleDef } from '../contracts';

/** Typed helper for manifest `jobs` entries. */
export function defineJob<T>(handler: Lazy<JobHandler<T>>, options?: JobOptions): JobDef<T> {
  return options ? { handler, options } : { handler };
}

export interface EnqueueOptions {
  /** Write the job in the caller's transaction (it exists only if the transaction commits). */
  tx?: Tx;
  startAfter?: Date | number;
  singletonKey?: string;
  priority?: number;
}

/** Queues a job declared in some module's manifest. Returns the job id (null when a singleton dropped it). */
export async function enqueue(name: string, data: object = {}, options: EnqueueOptions = {}): Promise<string | null> {
  const boss = await getBoss();
  const { tx, ...rest } = options;
  return boss.send(name, data, { ...rest, ...(tx ? { db: txDb(tx) } : {}) });
}

export interface WorkerOptions {
  /** Defaults to `<hostname>:<pid>`. */
  name?: string;
  heartbeatSeconds?: number;
  /** Poll faster in tests (>= 0.5). */
  pollingIntervalSeconds?: number;
}

/**
 * Worker entry (apps/<app>/worker.ts): creates every enabled module's queues with the standard retry
 * policy and dead-letter queue, works them, registers cron schedules (Asia/Kolkata by default), routes
 * events to subscribers and writes a heartbeat row.
 */
export async function startWorker(registry: Registry, options: WorkerOptions = {}): Promise<{ stop(): Promise<void> }> {
  const log = createLogger('worker');
  const boss = createWorkerBoss();
  await boss.start();
  setSharedBoss(boss);
  const polling = options.pollingIntervalSeconds ? { pollingIntervalSeconds: options.pollingIntervalSeconds } : {};
  const queues: string[] = [];

  for (const job of registry.jobs) {
    await ensureQueue(boss, job.name, job.def.options);
    queues.push(job.name);
    let handler: JobHandler<unknown> | undefined;
    const jobLog = createLogger(job.name, { module: job.moduleId });
    await boss.work<object>(job.name, polling, async (batch) => {
      handler ??= (await job.def.handler()) as JobHandler<unknown>;
      // a scheduled run carries no payload (pg-boss stores null): handlers read an empty object, not null
      for (const j of batch) await handler(j.data ?? {}, { jobId: j.id, queue: job.name, attempt: j.retryCount + 1, log: jobLog });
    });
  }

  queues.push(...(await startEventRouting(boss, registry, { log, ...polling })));

  const wanted = new Set(registry.schedules.map((s) => s.job));
  for (const s of await boss.getSchedules()) if (!wanted.has(s.name)) await boss.unschedule(s.name);
  for (const s of registry.schedules) await boss.schedule(s.job, s.cron, s.data ?? null, { tz: s.tz ?? 'Asia/Kolkata' });

  const name = options.name ?? `${hostname()}:${process.pid}`;
  const beat = () =>
    upsertRequireUpdate(db, coreJobHeartbeat, { worker: name, queues }, { target: coreJobHeartbeat.worker, set: { lastSeen: sql`now()`, queues } }).catch(
      (err: unknown) => log.error('heartbeat failed', { error: String(err) }),
    );
  await beat();
  const timer = setInterval(beat, (options.heartbeatSeconds ?? 30) * 1000);
  timer.unref();
  log.info('worker started', { queues: queues.length, schedules: registry.schedules.length });

  return {
    async stop() {
      clearInterval(timer);
      setSharedBoss(null);
      await boss.stop({ graceful: true, timeout: 10_000 });
      log.info('worker stopped');
    },
  };
}
