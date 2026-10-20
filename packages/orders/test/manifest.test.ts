import { fileURLToPath } from 'node:url';
import { createRegistry, resolveModules } from '@ecomkit/core/manifest';
import core from '@ecomkit/core/manifest';
import type { ModuleManifest } from '@ecomkit/core/contracts';
import { describe, expect, it } from 'vitest';
import manifest from '../src/manifest';

const stub = (id: string): ModuleManifest => ({ id, dependsOn: ['core'] });

describe('orders manifest', () => {
  it('resolves with its dependencies, every route module exports what its stub re-exports, and the paid subscriber loads', async () => {
    const deps = manifest.dependsOn.filter((d) => d !== 'core').map(stub);
    const ordered = resolveModules([core, ...deps, manifest], ['core', ...deps.map((d) => d.id), manifest.id]);
    expect(ordered.at(-1)!.id).toBe('orders');
    for (const r of [...(manifest.routes ?? []), ...(manifest.admin?.pages ?? [])]) {
      const mod = (await import(/* @vite-ignore */ fileURLToPath(new URL(`../src/${r.module}.tsx`, import.meta.url)))) as Record<string, unknown>;
      for (const name of r.exports) expect(typeof mod[name], `${r.module} ${name}`).toBe('function');
    }
    const registry = createRegistry([core, ...deps, manifest], { mocks: false });
    expect(registry.subscribers('order.paid').map((s) => s.moduleId)).toEqual(['orders']);
    expect(typeof (await manifest.on!['order.paid']!())).toBe('function');
    expect(Object.keys(await manifest.schema!())).toEqual(expect.arrayContaining(['ordersOrder', 'ordersLine', 'ordersEvent', 'ordersInvoice', 'ordersFulfilment']));
  });
});
