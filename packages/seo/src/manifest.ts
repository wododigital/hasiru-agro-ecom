import { defineModule } from '@ecomkit/core/manifest';

const route = (path: string, module: string, exports: ('GET' | 'default')[] = ['GET']) => ({ path, module: `routes/${module}`, kind: 'route', exports }) as const;
const admin = (path: string, module: string) => ({ path, module: `routes/${module}`, kind: 'page', exports: ['default'] }) as const;

/**
 * SEO: metadata and JSON-LD builders, sitemap index and files (from every module's sitemapSources), robots.txt,
 * llms.txt, OG image cards, redirects with loop and chain guards, the 404 log and page meta overrides.
 * The host binds site identity and the registry once with `configureSeo` (see README); app/not-found.tsx
 * re-exports `@ecomkit/seo/routes/not-found`.
 */
export default defineModule({
  id: 'seo',
  dependsOn: ['core'],
  schema: () => import('./schema'),
  routes: [
    route('/sitemap.xml', 'sitemap-index'),
    route('/sitemap/[file]', 'sitemap-file'),
    route('/robots.txt', 'robots'),
    route('/llms.txt', 'llms'),
    route('/og/[...slug]', 'og'),
  ],
  admin: {
    nav: [{ label: 'SEO', href: '/admin/seo', icon: 'search-check', order: 590, permission: 'content.write' }],
    pages: [admin('/admin/seo', 'admin-redirects'), admin('/admin/seo/not-found', 'admin-not-found'), admin('/admin/seo/page-meta', 'admin-page-meta')],
  },
  productFormTabs: [{ id: 'seo', label: 'SEO', order: 90, permission: 'products.read', component: () => import('./admin/SeoProductTab').then((m) => m.SeoProductTab) }],
  permissions: ['content.write'],
  cacheTags: ['settings:seo'],
  jobs: {
    'seo.prune-not-found': { handler: () => import('./server/jobs').then((m) => m.pruneNotFoundJob) },
  },
  schedules: [{ job: 'seo.prune-not-found', cron: '45 3 * * *' }],
  seedHooks: [{ id: 'redirects', order: 90, run: () => import('./server/seed').then((m) => m.runSeed) }],
});
