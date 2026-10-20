import type { PlacesReader } from '@ecomkit/core/contracts';
import { newId } from '@ecomkit/core/ids';
import { TEST_NOW, type TestDb } from '@ecomkit/core/testing';
import { setSettings } from '@ecomkit/core/settings';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { shippingSlot, shippingSlotBooking } from '../src/schema';
import {
  bookSlot,
  cancelBooking,
  configureShipping,
  loadShippingSeed,
  nextSlots,
  onOrderCancelled,
  onPaymentFailed,
  packingFee,
  pickVehicle,
  quoteMethods,
  readShippingSeed,
  seedHook,
  shippingQuoter,
  slotLoad,
} from '../src/server';
import { shippingSettings } from '../src/settings';
import { FIXTURE_DIR, fixtureSeed, shippingDb } from './helpers';

let t: TestDb;
const at = { now: TEST_NOW };
const local = { pincode: null, districtSlug: 'bengaluru-urban', stateCode: 'KA' };
const mysuru = { pincode: null, districtSlug: 'mysuru', stateCode: 'KA' };
const book = (slotDate: string, weightKg: number, now = TEST_NOW) => bookSlot({ orderId: newId(), orderNumber: `T-${Math.random().toString(36).slice(2, 8)}`, slotDate, weightKg }, { now });
const fakePlaces = (km: Record<string, number>): PlacesReader => ({
  suggest: async () => [],
  fit: async () => ({ level: 'good', reasons: [] }),
  getDistrict: async (slug) => (slug in km ? { slug, name: slug, stateCode: 'TN', stateName: 'Tamil Nadu', gstStateCode: '33', distanceKm: km[slug]!, lat: null, lng: null } : null),
});

beforeAll(async () => {
  t = await shippingDb('server');
  const first = await seedHook({ seedDir: FIXTURE_DIR, mediaDir: FIXTURE_DIR, dryRun: false, log: console });
  expect(first.inserted).toBe(2 + 3 + 3 + 1 + 3);
}, 120_000);

afterAll(async () => {
  await t?.close();
});

beforeEach(async () => {
  configureShipping({});
  await t.db.delete(shippingSlotBooking);
});

describe('seed', () => {
  it('is idempotent: a second run changes nothing and keeps admin edits', async () => {
    await t.db.update(shippingSlot).set({ cutoffHours: 30 });
    const again = await loadShippingSeed(await fixtureSeed());
    expect(again.inserted).toBe(0);
    expect(again.skipped).toBe(12);
    expect((await t.db.select().from(shippingSlot))[0]?.cutoffHours).toBe(30);
    await t.db.update(shippingSlot).set({ cutoffHours: 24 });
  });

  it('reports a missing seed file instead of failing', async () => {
    expect(await readShippingSeed('/nonexistent')).toBeNull();
    expect((await seedHook({ seedDir: '/nonexistent', mediaDir: '/', dryRun: false, log: console })).notes?.[0]).toMatch(/no shipping.json/);
  });
});

describe('quoteMethods', () => {
  it('local address, 2,000 kg: medium vehicle Rs 3,500 on the next Saturdays; outstation points to local', async () => {
    const quotes = await quoteMethods({ lines: [], totalWeightKg: 2000, address: local }, at);
    const byKind = Object.fromEntries(quotes.map((q) => [q.kind, q]));
    expect(byKind.pickup).toMatchObject({ available: true, pricePaise: 0, promise: { earliest: '2026-10-21' } });
    expect(byKind.local_slot).toMatchObject({ available: true, pricePaise: 350_000, vehicle: { label: 'Medium truck', trips: 1, fillPct: 80 }, promise: { earliest: '2026-10-24' } });
    expect(byKind.local_slot!.slots.map((s) => s.date)).toEqual(['2026-10-24', '2026-10-31', '2026-11-07', '2026-11-14']);
    expect(byKind.outstation).toMatchObject({ available: false, unavailableReason: 'shipping.use_local' });
  });

  it('Mysuru at the 150 km override: Rs 22 / 35 / 48 per km by vehicle, times trips', async () => {
    const price = async (kg: number) => (await quoteMethods({ lines: [], totalWeightKg: kg, address: mysuru }, at)).find((q) => q.kind === 'outstation')!;
    expect(await price(500)).toMatchObject({ available: true, pricePaise: 330_000, distanceKm: 150, vehicle: { label: 'Small pickup' } });
    expect((await price(2000)).pricePaise).toBe(525_000);
    expect((await price(4000)).pricePaise).toBe(720_000);
    expect(await price(6000)).toMatchObject({ pricePaise: 1_440_000, vehicle: { trips: 2, fillPct: 20 } });
    expect((await price(2000)).promise).toEqual({ earliest: '2026-10-25', latest: '2026-10-27' });
  });

  it('takes the distance from the places service when no override exists, and says so when neither knows', async () => {
    const chennai = { pincode: null, districtSlug: 'chennai', stateCode: 'TN' };
    expect((await quoteMethods({ lines: [], totalWeightKg: 2000, address: chennai }, at)).find((q) => q.kind === 'outstation')).toMatchObject({
      available: false,
      unavailableReason: 'shipping.distance_unknown',
    });
    configureShipping({ places: async () => fakePlaces({ chennai: 350.4, mysuru: 999 }) });
    expect((await quoteMethods({ lines: [], totalWeightKg: 2000, address: chennai }, at)).find((q) => q.kind === 'outstation')).toMatchObject({ pricePaise: 350 * 3_500, distanceKm: 350 });
    // The admin override wins over the service estimate.
    expect((await quoteMethods({ lines: [], totalWeightKg: 2000, address: mysuru }, at)).find((q) => q.kind === 'outstation')?.distanceKm).toBe(150);
  });

  it('an unserved state is enquiry only', async () => {
    const quotes = await quoteMethods({ lines: [], totalWeightKg: 10, address: { pincode: null, districtSlug: 'pune', stateCode: 'MH' } }, at);
    expect(quotes.filter((q) => q.available).map((q) => q.kind)).toEqual(['pickup']);
    expect(quotes.at(-1)).toMatchObject({ kind: 'enquiry_only', unavailableReason: 'shipping.enquiry_only' });
  });

  it('carries the packing fee from the lines (and stored rules) on every method', async () => {
    const lines = [
      { variantId: 'a', qty: 10, weightKg: 1, packingFeePaise: 500 as never },
      { variantId: 'b', qty: 2, weightKg: 3, packingFeePaise: 1500 as never },
    ];
    const quotes = await quoteMethods({ lines, totalWeightKg: 16, address: local }, at);
    expect(new Set(quotes.map((q) => q.packingPaise))).toEqual(new Set([8000]));
    expect(await packingFee(lines)).toBe(8000);
  });

  it('is the shipping service: pickVehicle through the contract', async () => {
    expect(await shippingQuoter.pickVehicle(800)).toEqual({ vehicleId: expect.any(String), label: 'Medium truck', capacityKg: 2500, trips: 1, fillPct: 32 });
    expect(await pickVehicle(0)).toBeNull();
  });
});

describe('slot capacity, cutoff and bookings', () => {
  it('a full day drops out of the dates for a heavier order; exact remaining room still fits', async () => {
    expect((await book('2026-10-24', 14_500)).ok).toBe(true);
    expect((await nextSlots(2, { weightKg: 501, ...at })).map((s) => s.date)).toEqual(['2026-10-31', '2026-11-07']);
    expect((await nextSlots(1, { weightKg: 500, ...at }))[0]).toMatchObject({ date: '2026-10-24', remainingKg: 500 });
    expect(await book('2026-10-24', 501)).toEqual({ ok: false, reason: 'slot_full' });
    expect((await book('2026-10-24', 500)).ok).toBe(true);
    expect(await slotLoad('2026-10-24')).toEqual({ orders: 2, weightKg: 15_000 });
  });

  it('ten orders racing for the last room: exactly one gets it', async () => {
    await book('2026-10-31', 14_000);
    const results = await Promise.all(Array.from({ length: 10 }, () => book('2026-10-31', 600)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.reason === 'slot_full')).toBe(true);
    expect((await slotLoad('2026-10-31')).weightKg).toBe(14_600);
  });

  it('refuses a day past its cutoff (Friday 00:00 IST for Saturday), a non-slot day and a blackout date', async () => {
    expect((await book('2026-10-24', 10, new Date('2026-10-22T23:59:00+05:30'))).ok).toBe(true);
    expect(await book('2026-10-24', 10, new Date('2026-10-23T00:00:00+05:30'))).toEqual({ ok: false, reason: 'slot_closed' });
    expect(await book('2026-10-25', 10)).toEqual({ ok: false, reason: 'slot_closed' });
    await setSettings(shippingSettings, { blackout_dates: '2026-11-07' }, { actorId: null });
    expect(await book('2026-11-07', 10)).toEqual({ ok: false, reason: 'slot_closed' });
    expect((await nextSlots(3, at)).map((s) => s.date)).toEqual(['2026-10-24', '2026-10-31', '2026-11-14']);
    await setSettings(shippingSettings, { blackout_dates: '' }, { actorId: null });
  });

  it('is idempotent per order and frees the room on cancel, order.cancelled and order.payment_failed', async () => {
    const orderId = newId();
    const first = await bookSlot({ orderId, orderNumber: 'T-1', slotDate: '2026-10-24', weightKg: 100 }, at);
    const again = await bookSlot({ orderId, orderNumber: 'T-1', slotDate: '2026-10-24', weightKg: 100 }, at);
    expect(again).toEqual(first);
    expect((await slotLoad('2026-10-24')).orders).toBe(1);
    expect(await cancelBooking(orderId)).toBe(true);
    expect(await cancelBooking(orderId)).toBe(false);
    expect((await slotLoad('2026-10-24')).orders).toBe(0);
    // A cancelled order placed again books afresh.
    expect((await bookSlot({ orderId, orderNumber: 'T-1', slotDate: '2026-10-24', weightKg: 100 }, at)).ok).toBe(true);

    const ctx = { eventId: newId(), log: console } as never;
    await onOrderCancelled({ orderId, orderNumber: 'T-1', reason: null }, ctx);
    expect((await slotLoad('2026-10-24')).orders).toBe(0);
    const other = newId();
    await bookSlot({ orderId: other, orderNumber: 'T-2', slotDate: '2026-10-24', weightKg: 100 }, at);
    await onPaymentFailed({ orderId: other, orderNumber: 'T-2', reason: 'expired' }, ctx);
    const [row] = await t.db.select().from(shippingSlotBooking).where(eq(shippingSlotBooking.orderId, other));
    expect(row?.cancelledAt).not.toBeNull();
  });
});
