import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EventPayloads } from '../src/contracts';
import { withTx } from '../src/db';
import { emit } from '../src/events';
import { enqueue, startWorker } from '../src/jobs';
import coreManifest, { createRegistry, defineModule } from '../src/manifest';
import { coreJobHeartbeat } from '../src/schema';
import { createTestDb, queuedJobs, type TestDb } from '../src/testing';

let t: TestDb;
let worker: { stop(): Promise<void> } | undefined;
const paid: EventPayloads['order.paid'][] = [];
const pings: unknown[] = [];
let failOnce = true;

const testModule = defineModule({
  id: 'test-mod',
  dependsOn: ['core'],
  on: {
    'order.paid': async () => async (payload) => {
      paid.push(payload);
    },
  },
  jobs: {
    'test-mod.ping': {
      handler: async () => async (data: unknown) => {
        if (failOnce) {
          failOnce = false;
          throw new Error('transient');
        }
        pings.push(data);
      },
      options: { retryDelaySec: 1, retryBackoff: false },
    },
  },
});

async function waitFor(check: () => boolean, ms = 15_000): Promise<void> {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}

beforeAll(async () => {
  t = await createTestDb('wp-00b-worker');
  worker = await startWorker(createRegistry([coreManifest, testModule], { mocks: true }), { name: 'test-worker', pollingIntervalSeconds: 0.5 });
}, 60_000);

afterAll(async () => {
  await worker?.stop();
  await t?.close();
});

describe('worker', () => {
  it('routes an event emitted in a transaction to its subscriber once', async () => {
    await withTx((tx) => emit('order.paid', { orderId: 'o1', orderNumber: 'HA-2610-00001', amountPaise: 12_300 as never, paymentAttemptId: null }, { tx }));
    await waitFor(() => paid.length === 1);
    expect(paid[0]).toMatchObject({ orderId: 'o1', amountPaise: 12_300 });
    expect(await queuedJobs(t.db, 'test-mod.on.order.paid')).toHaveLength(1);
  });

  it('runs module jobs with the retry policy and creates the dead-letter queue', async () => {
    await enqueue('test-mod.ping', { n: 1 });
    await waitFor(() => pings.length === 1);
    expect(pings[0]).toEqual({ n: 1 });
    const { rows } = await t.pool.query<{ name: string; dead_letter: string | null; retry_limit: number }>(
      "select name, dead_letter, retry_limit from pgboss.queue where name like 'test-mod.%' order by name",
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'test-mod.ping', dead_letter: 'test-mod.ping.dead', retry_limit: 5 }),
        expect.objectContaining({ name: 'test-mod.ping.dead' }),
      ]),
    );
  }, 30_000);

  it('registers schedules and writes a heartbeat', async () => {
    const { rows } = await t.pool.query<{ name: string; cron: string; timezone: string }>('select name, cron, timezone from pgboss.schedule');
    expect(rows).toEqual([expect.objectContaining({ name: 'core.prune', cron: '30 3 * * *', timezone: 'Asia/Kolkata' })]);
    const beats = await t.db.select().from(coreJobHeartbeat);
    expect(beats[0]?.worker).toBe('test-worker');
    expect(beats[0]?.queues).toEqual(expect.arrayContaining(['core.prune', 'test-mod.ping', 'core.event', 'test-mod.on.order.paid']));
  });
});
