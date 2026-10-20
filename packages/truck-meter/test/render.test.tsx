import { randomBytes } from 'node:crypto';
import type { CartBlockLine, CartBlockProps } from '@ecomkit/core/contracts';
import { createTestDb, type TestDb } from '@ecomkit/core/testing';
import { shippingSeedSchema } from '@ecomkit/shipping/domain';
import { loadConfig, loadShippingSeed } from '@ecomkit/shipping/server';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureTruckMeter } from '../src/server';
import { SmallOrderBarBlock, TruckMeterBlock } from '../src/ui';

let t: TestDb;
let pickupId = '';
let localId = '';
const line = (qty: number, weightKg: number): CartBlockLine => ({ lineId: `l${qty}`, kind: 'product', productId: 'p', variantId: 'v', qty, weightKg, packageId: null, origin: null });
const props = (lines: CartBlockLine[], selectedMethodId: string | null = null): CartBlockProps => ({ cartId: 'c', lines, totals: null, selectedMethodId });
const html = async (el: Promise<ReactElement | null>) => {
  const node = await el;
  return node ? renderToStaticMarkup(node) : '';
};

beforeAll(async () => {
  process.env.INTERNAL_SECRET ??= 'i'.repeat(40);
  process.env.SETTINGS_MASTER_KEY ??= `1:${randomBytes(32).toString('base64')}`;
  t = await createTestDb('wp-18-truck-meter', { schemas: ['core', 'shipping'] });
  // Sample fleet through shipping's public seed loader: 750 / 2,500 / 5,000 kg.
  await loadShippingSeed(
    shippingSeedSchema.parse({
      version: 1,
      records: {
        methods: [
          { name: 'Pickup', kind: 'pickup' },
          { name: 'Local', kind: 'local_slot' },
        ],
        vehicles: [
          { name: 'Small pickup', capacity_kg: 750, local_flat_rs: 1500, per_km_rs: 22 },
          { name: 'Medium truck', capacity_kg: 2500, local_flat_rs: 3500, per_km_rs: 35 },
          { name: 'Large truck', capacity_kg: 5000, local_flat_rs: 6000, per_km_rs: 48 },
        ],
      },
    }),
  );
  const { methods } = await loadConfig();
  pickupId = methods.find((m) => m.kind === 'pickup')!.id;
  localId = methods.find((m) => m.kind === 'local_slot')!.id;
}, 120_000);

afterAll(async () => {
  await t?.close();
});

describe('truck meter cart block', () => {
  it('shows vehicle, fill, room left and the vehicle change from the cart lines (weight x qty)', async () => {
    const out = await html(TruckMeterBlock(props([line(100, 3), line(150, 1.25)], localId)));
    expect(out).toContain('Small pickup 65% full');
    expect(out).toContain('487.5 kg of 750 kg');
    expect(out).toContain('aria-valuenow="65"');
    expect(out).toContain('width:65%');
    expect(out).toContain('Add about 263 kg (~35% more)');
    expect(out).toContain('Above 750 kg the order moves up to a Medium truck.');
  });

  it('says "Nicely packed" at 90% and up, with no vehicle-change hint', async () => {
    const out = await html(TruckMeterBlock(props([line(225, 3)])));
    expect(out).toContain('Small pickup 90% full');
    expect(out).toContain('Nicely packed. You are using this trip well.');
    expect(out).not.toContain('moves up');
  });

  it('meters the last trip of a multi-trip order', async () => {
    const out = await html(TruckMeterBlock(props([line(4000, 3)])));
    expect(out).toContain('3 trips, Large truck 40% full');
    expect(out).toContain('2,000 kg of 5,000 kg on the last trip');
  });

  it('empty cart shows the empty state; pickup hides the meter', async () => {
    expect(await html(TruckMeterBlock(props([])))).toContain('Add items to see how much');
    expect(await html(TruckMeterBlock(props([line(10, 3)], pickupId)))).toBe('');
  });

  it('checkout summary gets the compact small-order bar', async () => {
    const out = await html(SmallOrderBarBlock(props([line(100, 3)])));
    expect(out).toContain('data-truck-meter="bar"');
    expect(out).toContain('Delivery vehicle 40% full. Add about 450 kg at no extra delivery cost.');
    expect(await html(SmallOrderBarBlock(props([])))).toBe('');
  });

  it('takes host copy overrides', async () => {
    configureTruckMeter({ messages: { note: 'Weights are estimates per sapling with its bag.' } });
    expect(await html(TruckMeterBlock(props([line(10, 3)])))).toContain('Weights are estimates per sapling with its bag.');
    configureTruckMeter({});
  });
});
