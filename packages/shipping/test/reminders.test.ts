import { newId } from '@ecomkit/core/ids';
import { startWorker } from '@ecomkit/core/jobs';
import coreManifest, { createRegistry } from '@ecomkit/core/manifest';
import { TEST_NOW, type TestDb } from '@ecomkit/core/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import shippingManifest from '../src/manifest';
import { shippingSlotBooking } from '../src/schema';
import { sendSlotReminders } from '../src/server';
import { outboxEvents, shippingDb } from './helpers';

let t: TestDb;
let worker: { stop(): Promise<void> } | undefined;

const booking = (slotDate: string, extra: Partial<typeof shippingSlotBooking.$inferInsert> = {}) => ({
  id: newId(),
  slotId: newId(),
  slotDate,
  orderId: newId(),
  orderNumber: `T-${slotDate}-${Math.random().toString(36).slice(2, 6)}`,
  weightKg: 100,
  ...extra,
});

beforeAll(async () => {
  t = await shippingDb('reminders');
}, 120_000);

afterAll(async () => {
  await worker?.stop();
  await t?.close();
});

describe('slot.reminder job', () => {
  it('emits once per order booked for tomorrow (IST), never twice, never for cancelled or later bookings', async () => {
    // TEST_NOW is Tuesday 20 Oct 10:00 IST, so tomorrow is 21 Oct.
    const due = [booking('2026-10-21'), booking('2026-10-21')];
    await t.db.insert(shippingSlotBooking).values([...due, booking('2026-10-22'), booking('2026-10-20'), booking('2026-10-21', { cancelledAt: new Date() })]);

    expect(await sendSlotReminders({ now: TEST_NOW })).toBe(2);
    expect(await sendSlotReminders({ now: TEST_NOW })).toBe(0);
    // Parallel runs (two workers) still emit nothing more.
    expect(await Promise.all([sendSlotReminders({ now: TEST_NOW }), sendSlotReminders({ now: TEST_NOW })])).toEqual([0, 0]);

    const events = await outboxEvents(t, 'slot.reminder');
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.orderId).sort()).toEqual(due.map((d) => d.orderId).sort());
    expect(events[0]).toMatchObject({ slotDate: '2026-10-21', orderNumber: expect.stringMatching(/^T-2026-10-21/) });

    // The next evening covers the 22nd: one more event, for that order only.
    expect(await sendSlotReminders({ now: new Date('2026-10-21T19:00:00+05:30') })).toBe(1);
    expect(await outboxEvents(t, 'slot.reminder')).toHaveLength(3);
  });

  it('the worker registers the hourly daytime schedule in IST', async () => {
    worker = await startWorker(createRegistry([coreManifest, shippingManifest], { mocks: true }), { name: 'shipping-test', pollingIntervalSeconds: 0.5 });
    const { rows } = await t.pool.query<{ name: string; cron: string; timezone: string }>("select name, cron, timezone from pgboss.schedule where name = 'shipping.slot-reminders'");
    expect(rows).toEqual([{ name: 'shipping.slot-reminders', cron: '0 8-20 * * *', timezone: 'Asia/Kolkata' }]);
  });
});
