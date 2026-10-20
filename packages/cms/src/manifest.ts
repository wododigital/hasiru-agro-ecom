import { defineModule } from '@ecomkit/core/manifest';

type Exp = 'default' | 'generateMetadata' | 'generateStaticParams';
const page = (path: string, module: string, exports: Exp[] = ['default', 'generateMetadata']) => ({ path, module: `routes/${module}`, kind: 'page', exports }) as const;
/** Unknown slugs wait for the full render (real 404 status) instead of the shared fallback shell. */
const blockingSlug = { unstable_paramMatching: { slug: 'blocking' } };
const admin = (path: string, module: string) => ({ path, module: `routes/${module}`, kind: 'page', exports: ['default'] }) as const;
const nav = (label: string, href: string, icon: string, order: number) => ({ label, href, icon, order, permission: 'content.write' }) as const;

/**
 * CMS: pages built from typed blocks, menus, policy pages, guides, videos (linked to products or planting models),
 * testimonials, portfolio, clients, team, results counters and the trust band, with one block editor and one
 * generic form for the simple types. The host binds media and seo capabilities with `configureCms` (README).
 */
export default defineModule({
  id: 'cms',
  dependsOn: ['core', 'media'],
  optional: ['seo'],
  schema: () => import('./schema'),
  routes: [
    { ...page('/[...slug]', 'page', ['default', 'generateMetadata', 'generateStaticParams']), segmentConfig: blockingSlug },
    { ...page('/policies/[slug]', 'policy', ['default', 'generateMetadata', 'generateStaticParams']), segmentConfig: blockingSlug },
    page('/guides', 'guides'),
    { ...page('/guides/[slug]', 'guide', ['default', 'generateMetadata', 'generateStaticParams']), segmentConfig: blockingSlug },
    page('/videos', 'videos'),
    page('/about', 'about'),
    page('/contact', 'contact'),
  ],
  admin: {
    nav: [
      nav('Pages', '/admin/content/pages', 'file-text', 500),
      nav('Policies', '/admin/content/pages?template=policy', 'scale', 501),
      nav('Menus', '/admin/content/menus', 'menu', 502),
      nav('Guides', '/admin/content/guides', 'book-open', 503),
      nav('Videos', '/admin/content/videos', 'video', 504),
      nav('Testimonials', '/admin/content/testimonials', 'quote', 505),
      nav('Portfolio', '/admin/content/portfolio', 'images', 506),
      nav('Clients', '/admin/content/clients', 'handshake', 507),
      nav('Team', '/admin/content/team', 'users', 508),
      nav('Counters', '/admin/content/counters', 'hash', 509),
      nav('Trust band', '/admin/content/trust', 'badge-check', 510),
    ],
    pages: [
      admin('/admin/content', 'admin-hub'),
      admin('/admin/content/pages', 'admin-pages'),
      admin('/admin/content/pages/[id]', 'admin-page-edit'),
      admin('/admin/content/menus', 'admin-menus'),
      admin('/admin/content/menus/[key]', 'admin-menu-edit'),
      admin('/admin/content/[entity]', 'admin-entities'),
      admin('/admin/content/[entity]/[id]', 'admin-entity-edit'),
    ],
  },
  permissions: ['content.write'],
  cacheTags: ['nav', 'cms:<key>'],
  sitemapSources: [
    { name: 'pages', entries: () => import('./server/queries').then((m) => m.pageEntries) },
    { name: 'guides', entries: () => import('./server/queries').then((m) => m.guideEntries) },
  ],
  seedHooks: [{ id: 'content', order: 50, run: () => import('./server/seed').then((m) => m.runSeed) }],
});
