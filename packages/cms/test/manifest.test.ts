import coreManifest from '@ecomkit/core/manifest';
import { createRegistry, planFiles } from '@ecomkit/core/manifest';
import { describe, expect, it } from 'vitest';
import manifest from '../src/manifest';

// cms depends on media; a stand-in manifest keeps this test independent of the media package's build state.
const media = { id: 'media', dependsOn: ['core'] } as const;

describe('cms manifest', () => {
  const registry = createRegistry([coreManifest, media, manifest], { mocks: false });

  it('every route and admin page module exists and exports what its stub re-exports', async () => {
    for (const def of [...(manifest.routes ?? []), ...(manifest.admin?.pages ?? [])]) {
      const mod = (await import(`../src/routes/${def.module.replace('routes/', '')}.tsx`)) as Record<string, unknown>;
      for (const name of def.exports) expect(typeof mod[name], `${def.module}.${name}`).toBe('function');
    }
    const files = planFiles({ app: 'shop', modules: ['core', 'media', 'cms'], mocks: false }, registry.modules).map((f) => f.path);
    expect(files).toEqual(
      expect.arrayContaining([
        'app/(shop)/[...slug]/page.tsx',
        'app/(shop)/policies/[slug]/page.tsx',
        'app/(shop)/guides/page.tsx',
        'app/(shop)/guides/[slug]/page.tsx',
        'app/(shop)/videos/page.tsx',
        'app/(shop)/about/page.tsx',
        'app/(shop)/contact/page.tsx',
        'app/(admin)/admin/content/[entity]/[id]/page.tsx',
      ]),
    );
  });

  it('nav sits in the content band; sitemap sources and the seed hook load', async () => {
    const nav = registry.nav.filter((n) => n.moduleId === 'cms');
    expect(nav.every((n) => n.order >= 500 && n.order < 600)).toBe(true);
    expect(registry.list('sitemapSources').map((s) => s.name)).toEqual(['pages', 'guides']);
    for (const s of registry.list('sitemapSources')) expect(typeof (await s.entries())).toBe('function');
    const [hook] = registry.list('seedHooks');
    expect(hook?.id).toBe('content');
    expect(typeof (await hook!.run())).toBe('function');
  });
});
