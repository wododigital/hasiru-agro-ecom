import { defineModule } from '@ecomkit/core/manifest';
import { catalogSettingsSchema } from './settings';

const page = (path: string, module: string, exports: ('default' | 'generateMetadata' | 'generateStaticParams')[] = ['default', 'generateMetadata']) =>
  ({ path, module: `routes/${module}`, kind: 'page', exports }) as const;
/**
 * Slugs not prerendered at build wait for the full render instead of getting the shared fallback shell, so an
 * unknown slug answers a real 404 (notFound() before anything streams) and a new product still renders on demand.
 */
const blocking = (...params: string[]) => ({ unstable_paramMatching: Object.fromEntries(params.map((p) => [p, 'blocking'])) });

/**
 * Catalog: products, variants, collections, tags, FAQs, listing and product pages, the admin product form
 * (hosts productFormTabs), import/export and the data gaps view. Optional modules (pricing, inventory, reviews,
 * places, search, cart, seo, media rendering) are read through the registry and bound capabilities; when one is
 * off its part of the page renders nothing.
 */
export default defineModule({
  id: 'catalog',
  dependsOn: ['core', 'media'],
  optional: ['pricing', 'inventory', 'reviews', 'search', 'places', 'cart', 'seo'],
  schema: () => import('./schema'),
  routes: [
    page('/plants', 'plants'),
    { ...page('/plants/[collection]', 'plants-collection', ['default', 'generateMetadata', 'generateStaticParams']), segmentConfig: blocking('collection') },
    { ...page('/plants/[collection]/[sub]', 'plants-sub', ['default', 'generateMetadata', 'generateStaticParams']), segmentConfig: blocking('collection', 'sub') },
    { ...page('/plant/[slug]', 'plant', ['default', 'generateMetadata', 'generateStaticParams']), segmentConfig: blocking('slug') },
    page('/inputs', 'inputs'),
    { ...page('/input/[slug]', 'input', ['default', 'generateMetadata', 'generateStaticParams']), segmentConfig: blocking('slug') },
    { path: '/api/catalog/export', module: 'routes/export', kind: 'route', exports: ['GET'] },
  ],
  admin: {
    nav: [
      { label: 'Plants', href: '/admin/products', icon: 'sprout', order: 200, permission: 'products.read' },
      { label: 'Inputs', href: '/admin/inputs', icon: 'package', order: 201, permission: 'products.read' },
      { label: 'Collections', href: '/admin/collections', icon: 'folder-tree', order: 202, permission: 'products.read' },
      { label: 'Tags', href: '/admin/tags', icon: 'tags', order: 203, permission: 'products.read' },
      { label: 'FAQs', href: '/admin/faqs', icon: 'message-circle-question', order: 207, permission: 'products.read' },
      { label: 'Data gaps', href: '/admin/data-gaps', icon: 'list-checks', order: 208, permission: 'products.read' },
      { label: 'Import / Export', href: '/admin/import', icon: 'file-spreadsheet', order: 209, permission: 'products.write' },
    ],
    pages: [
      page('/admin/products', 'admin-products', ['default']),
      page('/admin/products/new', 'admin-product-new', ['default']),
      page('/admin/products/[id]', 'admin-product-edit', ['default']),
      page('/admin/inputs', 'admin-inputs', ['default']),
      page('/admin/collections', 'admin-collections', ['default']),
      page('/admin/tags', 'admin-tags', ['default']),
      page('/admin/faqs', 'admin-faqs', ['default']),
      page('/admin/data-gaps', 'admin-data-gaps', ['default']),
      page('/admin/import', 'admin-import', ['default']),
    ],
  },
  settings: { schema: catalogSettingsSchema },
  permissions: ['products.read', 'products.write'],
  emits: ['product.updated', 'product.published'],
  cacheTags: ['catalog', 'nav', 'product:<id>', 'category:<slug>'],
  sitemapSources: [
    { name: 'products', entries: () => import('./server/sitemap').then((m) => m.productEntries) },
    { name: 'collections', entries: () => import('./server/sitemap').then((m) => m.collectionEntries) },
  ],
  seedHooks: [{ id: 'products', order: 10, run: () => import('./server/seed-hook').then((m) => m.runSeed) }],
});
