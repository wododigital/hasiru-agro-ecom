import coreManifest, { createRegistry, defineModule, planFiles, resolveModules } from '@ecomkit/core/manifest';
import { describe, expect, it } from 'vitest';
import cartManifest from '../src/manifest';

const standIns = ['ui', 'catalog', 'pricing'].map((id) => defineModule({ id, dependsOn: ['core'] }));
const all = [coreManifest, ...standIns, cartManifest];

describe('manifest', () => {
  it('needs core, ui, catalog and pricing; inventory, discounts and shipping are optional', () => {
    expect(resolveModules(all, ['core', 'ui', 'catalog', 'pricing', 'cart']).map((m) => m.id)).toContain('cart');
    expect(() => resolveModules([coreManifest, cartManifest], ['core', 'cart'])).toThrow();
    expect(cartManifest.optional).toEqual(['inventory', 'discounts', 'shipping']);
  });

  it('generates the page and the three handlers', () => {
    const paths = planFiles({ app: 'shop', modules: ['core', 'ui', 'catalog', 'pricing', 'cart'], mocks: false }, all).map((f) => f.path);
    expect(paths).toEqual(expect.arrayContaining(['app/(shop)/cart/page.tsx', 'app/api/cart/route.ts', 'app/api/cart/lines/route.ts', 'app/api/cart/restore/route.ts']));
  });

  it('schedules the abandon job and wires every lazy reference', async () => {
    const registry = createRegistry(all, { mocks: false });
    expect(registry.jobs.map((j) => j.name)).toContain('cart.mark-abandoned');
    expect(typeof (await cartManifest.jobs!['cart.mark-abandoned']!.handler())).toBe('function');
    expect(Object.keys(await cartManifest.schema!())).toEqual(expect.arrayContaining(['cartCart', 'cartLine']));
    expect(cartManifest.emits).toEqual(['cart.updated', 'cart.abandoned']);
  });
});
