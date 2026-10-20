import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build, type Rolldown } from 'vite';
import { describe, expect, it } from 'vitest';

/**
 * BUILD-PLAN 4.3: the 3D route ships at most 450 KB of gzipped JS. This bundles what the route adds on top of the
 * framework (the viewer island, ui primitives, three, controls and the glTF loader) the way a production build does,
 * minified and split at the dynamic import, and checks the sizes. React and Next are the shared framework baseline
 * (about 120 KB gz on every page) and stay external here, so the route budget left for this module is 330 KB.
 */
const ROUTE_BUDGET_KB = 450;
const FRAMEWORK_BASELINE_KB = 120;

type Chunk = Rolldown.OutputChunk;

describe('3D route bundle', () => {
  it('three is in its own lazy chunk and the route stays under budget', { timeout: 120_000 }, async () => {
    const entry = fileURLToPath(new URL('../src/ui/PlantingViewerIsland.tsx', import.meta.url));
    const out = await build({
      configFile: false,
      logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' },
      build: {
        write: false,
        minify: true,
        target: 'es2022',
        assetsInlineLimit: 0,
        rollupOptions: { input: entry, preserveEntrySignatures: 'exports-only', external: [/^react(\/.*)?$/, /^react-dom(\/.*)?$/, /^next(\/.*)?$/] },
      },
    });
    const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) => ('output' in o ? o.output : []));
    const chunks = outputs.filter((o): o is Chunk => o.type === 'chunk');
    const gz = (c: Chunk) => gzipSync(c.code).length / 1024;
    const entryChunk = chunks.find((c) => c.isEntry)!;
    const lazy = chunks.filter((c) => !c.isEntry);
    const sizes = Object.fromEntries(chunks.map((c) => [c.fileName, Math.round(gz(c))]));
    console.info('3D route chunks (KB gz):', sizes);

    // The island itself is small and never pulls three in statically.
    expect(entryChunk.code).not.toContain('WebGLRenderer');
    expect(gz(entryChunk)).toBeLessThan(40);
    // three, the controls and the loader sit behind the dynamic import.
    const scene = lazy.find((c) => c.code.includes('WebGLRenderer'));
    expect(scene).toBeTruthy();
    // The mango model is emitted as a separate static asset, not inlined into JS.
    expect(outputs.some((o) => o.type === 'asset' && o.fileName.endsWith('.glb'))).toBe(true);
    expect(scene!.code).not.toMatch(/data:model\/gltf-binary|data:application\/octet-stream/);

    const total = chunks.reduce((a, c) => a + gz(c), 0);
    expect(total + FRAMEWORK_BASELINE_KB).toBeLessThan(ROUTE_BUDGET_KB);
  });
});
