import { routeFilePath } from '@ecomkit/core/manifest';
import { describe, expect, it } from 'vitest';
import manifest from '../src/manifest';
import { searchSettingsSchema } from '../src/settings';

describe('search manifest', () => {
  it('declares the routes this package owns, each exporting what the stub re-exports', async () => {
    const all = [...(manifest.routes ?? []), ...(manifest.admin?.pages ?? [])];
    expect(all.map((r) => r.path)).toEqual(['/search', '/api/search/suggest', '/api/search/log', '/facets.json', '/admin/search']);
    for (const r of all) {
      const mod = (await import(`../src/routes/${r.module.replace('routes/', '')}.tsx`)) as Record<string, unknown>;
      for (const name of r.exports) expect(typeof mod[name], `${r.module} ${name}`).toBe('function');
    }
  });

  it('maps to the app paths in the work package row', () => {
    const paths = (manifest.routes ?? []).map((r) => routeFilePath(r));
    expect(paths).toEqual(['app/(shop)/search/page.tsx', 'app/api/search/suggest/route.ts', 'app/api/search/log/route.ts', 'app/facets.json/route.ts']);
  });

  it('settings default to hidden CTAs and logging on; only https chat links and store paths are accepted', () => {
    expect(searchSettingsSchema.parse({})).toEqual({ assistanceUrl: '', guidedHref: '', logQueries: true });
    expect(searchSettingsSchema.safeParse({ assistanceUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(searchSettingsSchema.safeParse({ assistanceUrl: 'http://wa.me/1' }).success).toBe(false);
    expect(searchSettingsSchema.safeParse({ guidedHref: '//evil.example' }).success).toBe(false);
    expect(searchSettingsSchema.parse({ assistanceUrl: 'https://wa.me/910000000000', guidedHref: '/plan' }).guidedHref).toBe('/plan');
  });
});
