import { fileURLToPath } from 'node:url';
import { createRegistry, resolveModules } from '@ecomkit/core/manifest';
import core from '@ecomkit/core/manifest';
import type { ModuleManifest } from '@ecomkit/core/contracts';
import { describe, expect, it } from 'vitest';
import manifest from '../src/manifest';

const stub = (id: string): ModuleManifest => ({ id, dependsOn: ['core'] });

describe('checkout manifest', () => {
  it('resolves with its dependencies and every route module exports what its stub re-exports', async () => {
    const deps = manifest.dependsOn.filter((d) => d !== 'core').map(stub);
    const ordered = resolveModules([core, ...deps, manifest], ['core', ...deps.map((d) => d.id), manifest.id]);
    expect(ordered.at(-1)!.id).toBe('checkout');
    for (const r of manifest.routes ?? []) {
      const mod = (await import(/* @vite-ignore */ fileURLToPath(new URL(`../src/${r.module}.tsx`, import.meta.url)))) as Record<string, unknown>;
      for (const name of r.exports) expect(typeof mod[name], `${r.module} ${name}`).toBe('function');
    }
    expect(createRegistry([core, ...deps, manifest], { mocks: false }).has('checkout')).toBe(true);
    expect(Object.keys(await manifest.schema!())).toContain('checkoutSession');
    expect(manifest.emits).toEqual(['checkout.started', 'checkout.contact_saved']);
  });
});
