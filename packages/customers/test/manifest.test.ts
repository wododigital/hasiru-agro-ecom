import { fileURLToPath } from 'node:url';
import { createRegistry, resolveModules } from '@ecomkit/core/manifest';
import core from '@ecomkit/core/manifest';
import type { ModuleManifest } from '@ecomkit/core/contracts';
import { describe, expect, it } from 'vitest';
import manifest from '../src/manifest';

// Stand-ins for the hard dependencies that land in other work packages.
const stub = (id: string): ModuleManifest => ({ id, dependsOn: ['core'] });

describe('customers manifest', () => {
  it('resolves with its dependencies and every declared route module exports what the stub re-exports', async () => {
    const deps = manifest.dependsOn.filter((d) => d !== 'core').map(stub);
    const ordered = resolveModules([core, ...deps, manifest], ['core', ...deps.map((d) => d.id), manifest.id]);
    expect(ordered.at(-1)!.id).toBe('customers');
    const routes = [...(manifest.routes ?? []), ...(manifest.admin?.pages ?? [])];
    for (const r of routes) {
      const file = fileURLToPath(new URL(`../src/${r.module}.tsx`, import.meta.url));
      const mod = (await import(/* @vite-ignore */ file)) as Record<string, unknown>;
      for (const name of r.exports) expect(typeof mod[name], `${r.module} ${name}`).toBe('function');
    }
    for (const n of manifest.admin?.nav ?? []) expect(n.order).toBeGreaterThanOrEqual(0);
    const registry = createRegistry([core, ...deps, manifest], { mocks: false });
    expect(registry.has('customers')).toBe(true);
    expect(Object.keys(await manifest.schema!())).not.toHaveLength(0);
  });
});
