import coreManifest, { createRegistry, defineModule, resolveModules } from '@ecomkit/core/manifest';
import shippingManifest from '@ecomkit/shipping/manifest';
import { describe, expect, it } from 'vitest';
import truckMeterManifest from '../src/manifest';

const cartStandIn = defineModule({ id: 'cart', dependsOn: ['core'] });

describe('manifest', () => {
  it('needs cart and shipping', () => {
    expect(resolveModules([coreManifest, cartStandIn, shippingManifest, truckMeterManifest], ['core', 'cart', 'shipping', 'truck-meter']).map((m) => m.id).at(-1)).toBe('truck-meter');
    expect(() => resolveModules([coreManifest, cartStandIn, truckMeterManifest], ['core', 'cart', 'truck-meter'])).toThrow();
  });

  it('contributes the cart block and the checkout-summary bar', async () => {
    const registry = createRegistry([coreManifest, cartStandIn, shippingManifest, truckMeterManifest], { mocks: false });
    const blocks = registry.list('cartBlocks');
    expect(blocks.map((b) => [b.id, b.placement, b.moduleId])).toEqual([
      ['truck-meter', 'cart', 'truck-meter'],
      ['truck-meter.bar', 'checkout-summary', 'truck-meter'],
    ]);
    for (const b of blocks) expect(typeof (await b.component())).toBe('function');
  });
});
