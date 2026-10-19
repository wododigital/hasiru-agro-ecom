import { createHash } from 'node:crypto';
import type { PgBoss } from 'pg-boss';
import { EVENT_NAMES, type EmitOptions, type EventName, type EventPayloads, type Logger } from '../contracts';
import type { Registry } from '../manifest';
import type { Tx } from '../db';
import { newId } from '../ids/uuid';
import { ensureQueue, getBoss, txDb } from '../jobs/boss';

/** Every emit is one job on this queue; the worker fans it out to one job per subscriber. */
export const EVENT_QUEUE = 'core.event';
export const subscriberQueue = (moduleId: string, event: EventName) => `${moduleId}.on.${event}`;

export interface EventEnvelope<E extends EventName = EventName> {
  event: E;
  payload: EventPayloads[E];
  eventId: string;
  emittedAt: string;
}

const known = new Set<string>(EVENT_NAMES);
let queueReady: Promise<void> | null = null;

function isTx(value: unknown): value is Tx {
  return typeof value === 'object' && value !== null && typeof (value as { execute?: unknown }).execute === 'function';
}

/**
 * Emits a catalogue event. With `{ tx }` the job is written in the caller's transaction (outbox):
 * it exists only if the transaction commits. Without it the job is sent straight away.
 */
export async function emit<E extends EventName>(event: E, payload: EventPayloads[E], options: EmitOptions = {}): Promise<void> {
  if (!known.has(event)) throw new Error(`unknown event "${event}" (not in the catalogue)`);
  if (options.tx !== undefined && !isTx(options.tx)) throw new TypeError('emit: tx must be a Drizzle transaction');
  const boss = await getBoss();
  queueReady ??= ensureQueue(boss, EVENT_QUEUE);
  await queueReady;
  const envelope: EventEnvelope<E> = { event, payload, eventId: newId(), emittedAt: new Date().toISOString() };
  await boss.send(EVENT_QUEUE, envelope as unknown as object, options.tx ? { db: txDb(options.tx) } : {});
}

/** Deterministic job id per (event, subscriber): a retried fan-out never queues the same delivery twice. */
function deliveryId(eventId: string, moduleId: string): string {
  const h = createHash('sha256').update(`${eventId}:${moduleId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Worker side: creates the subscriber queues, fans events out, runs subscriber handlers. */
export async function startEventRouting(boss: PgBoss, registry: Registry, options: { log: Logger; pollingIntervalSeconds?: number }): Promise<string[]> {
  await ensureQueue(boss, EVENT_QUEUE);
  const queues = [EVENT_QUEUE];
  const polling = options.pollingIntervalSeconds ? { pollingIntervalSeconds: options.pollingIntervalSeconds } : {};

  await boss.work<EventEnvelope>(EVENT_QUEUE, polling, async (jobs) => {
    for (const job of jobs) {
      for (const sub of registry.subscribers(job.data.event)) {
        await boss.send(subscriberQueue(sub.moduleId, job.data.event), job.data as unknown as object, { id: deliveryId(job.data.eventId, sub.moduleId) });
      }
    }
  });

  for (const event of EVENT_NAMES) {
    for (const sub of registry.subscribers(event)) {
      const queue = subscriberQueue(sub.moduleId, event);
      await ensureQueue(boss, queue);
      queues.push(queue);
      const lazy = sub.handler as () => Promise<(payload: unknown, ctx: { eventId: string; emittedAt: Date; log: Logger }) => Promise<void>>;
      let handler: Awaited<ReturnType<typeof lazy>> | undefined;
      await boss.work<EventEnvelope>(queue, polling, async (jobs) => {
        handler ??= await lazy();
        for (const job of jobs) {
          await handler(job.data.payload, { eventId: job.data.eventId, emittedAt: new Date(job.data.emittedAt), log: options.log });
        }
      });
    }
  }
  return queues;
}

/** Test hook: forget the cached queue check after switching databases. */
export function resetEventQueue(): void {
  queueReady = null;
}
