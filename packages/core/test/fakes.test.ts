import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  EVENT_NAMES,
  MODULE_IDS,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  STAFF_ROLES,
  TEMPLATE_KEYS,
  type InventoryOps,
  type NotificationChannel,
  type PlacesReader,
  type PricingReader,
  type ReviewsReader,
  type ShippingQuoter,
} from '../src/contracts';
import { fakeFit, fakeInventory, fakeNotificationChannel, fakePricing, fakeReviews, fakeShippingQuote } from '../src/testing/fakes';

describe('fakes implement the frozen contracts', () => {
  it('types', () => {
    expectTypeOf(fakePricing()).toExtend<PricingReader>();
    expectTypeOf(fakeInventory()).toExtend<InventoryOps>();
    expectTypeOf(fakeFit()).toExtend<PlacesReader>();
    expectTypeOf(fakeReviews()).toExtend<ReviewsReader>();
    expectTypeOf(fakeShippingQuote()).toExtend<ShippingQuoter>();
    expectTypeOf(fakeNotificationChannel()).toExtend<NotificationChannel>();
  });

  it('pricing applies the bulk tier at its threshold', async () => {
    const pricing = fakePricing({ listPaise: 49_000, tier: { minQty: 50, unitPaise: 35_500 } });
    const below = await pricing.getPrice('v1', 49);
    expect(below).toMatchObject({ unitPaise: 49_000, tier: null, nextTier: { qtyToGo: 1 } });
    expect(await pricing.getPrice('v1', 50)).toMatchObject({ unitPaise: 35_500, lineTotalPaise: 1_775_000, nextTier: null });
  });

  it('inventory reserves, reports shortages and releases', async () => {
    const inv = fakeInventory({ out: 'out_of_stock', pre: 'preorder' });
    expect((await inv.getStock('out'))?.availability).toBe('out_of_stock');
    expect((await inv.getStock('pre'))?.readyInDays).toBe(30);
    const held = await inv.reserve([{ variantId: 'v', qty: 95 }], { ttlSec: 900, reference: 'attempt-1' });
    expect(held.ok).toBe(true);
    expect((await inv.getStock('v'))?.available).toBe(5);
    const short = await inv.reserve([{ variantId: 'v', qty: 6 }], { ttlSec: 900, reference: 'attempt-2' });
    expect(short).toEqual({ ok: false, shortages: [{ variantId: 'v', requested: 6, available: 5 }] });
    if (held.ok) await inv.release(held.reservation.reservationId);
    expect((await inv.getStock('v'))?.available).toBe(100);
  });

  it('fit is decided by district slug', async () => {
    const places = fakeFit({ mysuru: 'good' });
    expect((await places.fit('bengaluru-urban', { tempC: null, rainfallMm: null, humidityPct: null, soilTags: [] })).level).toBe('good');
    expect((await places.fit('ballari', { tempC: null, rainfallMm: null, humidityPct: null, soilTags: [] })).level).toBe('not_recommended');
    expect((await places.fit('mysuru', { tempC: null, rainfallMm: null, humidityPct: null, soilTags: [] })).level).toBe('good');
    expect((await places.suggest('mys')).map((s) => s.district.slug)).toEqual(['mysuru']);
  });

  it('reviews show a rating only with 3 or more approved', async () => {
    expect((await fakeReviews({ approved: 0 }).aggregate('p')).showRating).toBe(false);
    expect((await fakeReviews({ approved: 5 }).aggregate('p')).showRating).toBe(true);
  });

  it('shipping picks the smallest vehicle that fits and splits trips beyond the largest', async () => {
    const ship = fakeShippingQuote();
    expect(await ship.pickVehicle(600)).toMatchObject({ vehicleId: 'small', trips: 1, fillPct: 80 });
    expect(await ship.pickVehicle(12_000)).toMatchObject({ vehicleId: 'large', trips: 3, fillPct: 40 });
    const methods = await ship.quoteMethods({ lines: [{ variantId: 'v', qty: 10, weightKg: 3, packingFeePaise: 1_500 as never }], totalWeightKg: 30, address: null });
    expect(methods.map((m) => [m.kind, m.available])).toEqual([
      ['pickup', true],
      ['local_slot', true],
      ['outstation', false],
    ]);
    expect(methods[0]!.packingPaise).toBe(15_000);
  });

  it('notification channel records sends', async () => {
    const channel = fakeNotificationChannel();
    await channel.send({ messageId: 'm1', channel: 'log', to: '+919800000000', templateKey: 'test.send', locale: 'en-IN', subject: null, text: 'hi', html: null, whatsapp: null });
    expect(channel.sent.map((m) => m.templateKey)).toEqual(['test.send']);
  });
});

describe('catalogues', () => {
  it('have the frozen sizes and no duplicates', () => {
    expect(new Set(EVENT_NAMES).size).toBe(34);
    expect(new Set(PERMISSIONS).size).toBe(26);
    expect(new Set(TEMPLATE_KEYS).size).toBe(21);
    expect(new Set(MODULE_IDS).size).toBe(34);
  });
  it('role matrix only grants known permissions and the owner has all', () => {
    for (const role of STAFF_ROLES) for (const p of ROLE_PERMISSIONS[role]) expect(PERMISSIONS).toContain(p);
    expect(ROLE_PERMISSIONS.owner).toEqual(PERMISSIONS);
    expect(ROLE_PERMISSIONS.manager).not.toContain('settings.secrets');
  });
});
