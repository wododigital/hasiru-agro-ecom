import core, { createRegistry, planFiles, resolveModules } from '@ecomkit/core/manifest';
import { describe, expect, it } from 'vitest';
import media from '../src/manifest';

describe('media manifest', () => {
  it('resolves with core only and plans the route stubs', () => {
    const ordered = resolveModules([core, media], ['core', 'media']);
    const paths = planFiles({ app: 'shop', modules: ['core', 'media'], mocks: false }, ordered).map((f) => f.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'app/api/media/upload/route.ts',
        'app/media/[...path]/route.ts',
        'app/(admin)/admin/media/page.tsx',
        'app/(admin)/admin/media/[id]/page.tsx',
      ]),
    );
    expect(() => resolveModules([media], ['media'])).toThrow();
  });

  it('every lazy reference loads', async () => {
    const registry = createRegistry([core, media], { mocks: false });
    for (const job of registry.jobs.filter((j) => j.moduleId === 'media')) expect(typeof (await job.def.handler())).toBe('function');
    for (const s of media.seedHooks ?? []) expect(typeof (await s.run())).toBe('function');
    for (const h of media.healthChecks ?? []) expect(typeof (await h.run())).toBe('function');
    expect(Object.keys(await media.schema!())).toEqual(expect.arrayContaining(['mediaAsset', 'mediaDerivative', 'mediaUsage']));
    expect(registry.schedules.find((s) => s.job === 'media.warm')).toBeDefined();
  });
});
