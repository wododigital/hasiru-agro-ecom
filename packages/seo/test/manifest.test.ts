import coreManifest from '@ecomkit/core/manifest';
import { createRegistry, planFiles } from '@ecomkit/core/manifest';
import { describe, expect, it } from 'vitest';
import manifest from '../src/manifest';

describe('seo manifest', () => {
  const registry = createRegistry([coreManifest, manifest], { mocks: false });

  it('every route and admin page module exists and exports what the stub re-exports', async () => {
    const defs = [...(manifest.routes ?? []), ...(manifest.admin?.pages ?? [])];
    for (const def of defs) {
      const mod = (await import(`../src/routes/${def.module.replace('routes/', '')}.tsx`)) as Record<string, unknown>;
      for (const name of def.exports) expect(typeof mod[name], `${def.module}.${name}`).toBe('function');
    }
    const files = planFiles({ app: 'shop', modules: ['core', 'seo'], mocks: false }, registry.modules).map((f) => f.path);
    expect(files).toEqual(
      expect.arrayContaining(['app/sitemap.xml/route.ts', 'app/sitemap/[file]/route.ts', 'app/robots.txt/route.ts', 'app/llms.txt/route.ts', 'app/og/[...slug]/route.ts', 'app/(admin)/admin/seo/page.tsx']),
    );
  });

  it('contributes the SEO product form tab, nav in the content band, the prune job and the redirects seed hook', async () => {
    const [tab] = registry.list('productFormTabs');
    expect(tab).toMatchObject({ id: 'seo', moduleId: 'seo' });
    expect(typeof (await tab!.component())).toBe('function');
    expect(registry.nav.find((n) => n.moduleId === 'seo')?.order).toBeGreaterThanOrEqual(500);
    expect(registry.jobs.map((j) => j.name)).toContain('seo.prune-not-found');
    expect(registry.schedules.find((s) => s.job === 'seo.prune-not-found')).toBeTruthy();
    expect(typeof (await (await registry.jobs.find((j) => j.name === 'seo.prune-not-found')!.def.handler)())).toBe('function');
    expect(registry.list('seedHooks').map((h) => h.id)).toContain('redirects');
  });
});
