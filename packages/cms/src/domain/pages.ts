import { z } from 'zod';
import { blocksSchema } from './blocks';
import { SLUG_RE, checkbox, href, istDateTime, jsonInput, optText, publishStatus, reqText, slug, type FieldSpec } from './fields';

/**
 * First path segments the catch-all page can never serve because a module route owns them (a page there would be
 * unreachable). `about`, `contact` and `policies/*` are cms pages with their own routes and stay allowed.
 */
export const RESERVED_ROOTS = [
  'account', 'admin', 'api', 'cart', 'checkout', 'feeds', 'guides', 'kn', 'llms.txt', 'media', 'og', 'order', 'pay', 'r',
  'robots.txt', 'search', 'sitemap', 'sitemap.xml', 'videos',
] as const;

export const POLICY_PREFIX = 'policies/';

/** `about`, `farm-development/site-assessment`, `policies/delivery`: 1 to 3 kebab-case segments. */
export const pageSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((s) => s.replace(/^\/+|\/+$/g, ''))
  .refine((s) => {
    const parts = s.split('/');
    return parts.length >= 1 && parts.length <= 3 && parts.every((p) => SLUG_RE.test(p));
  }, 'one to three lowercase segments separated by /')
  .refine((s) => !(RESERVED_ROOTS as readonly string[]).includes(s.split('/')[0]!), 'that address belongs to another part of the store');

export const pagePath = (slug: string) => `/${slug}`;
export const isPolicySlug = (s: string) => s.startsWith(POLICY_PREFIX);
/** Cache tag key for a page (`/` is not allowed in tags; `_` never appears in a slug). */
export const pageTagKey = (s: string) => `page_${s.replace(/\//g, '_')}`;

export const TEMPLATES = ['default', 'landing', 'policy', 'service'] as const;

export const pageInputSchema = z
  .object({
    slug: pageSlugSchema,
    title: reqText(160),
    titleKn: optText(160),
    status: publishStatus,
    template: z.enum(TEMPLATES).default('default'),
    seoTitle: optText(160),
    seoDescription: optText(320),
    noindex: checkbox,
    publishedAt: istDateTime,
    blocks: z.preprocess(jsonInput, blocksSchema),
  })
  .transform((p) => (isPolicySlug(p.slug) ? { ...p, template: 'policy' as const } : p));

export type PageInput = z.output<typeof pageInputSchema>;

export const PAGE_FIELDS: readonly FieldSpec[] = [
  { name: 'title', label: 'Title', kind: 'text', required: true },
  { name: 'slug', label: 'Address', kind: 'text', required: true, help: 'e.g. about or policies/delivery (no leading slash)' },
  { name: 'titleKn', label: 'Title in Kannada', kind: 'text' },
  {
    name: 'template',
    label: 'Template',
    kind: 'select',
    options: TEMPLATES.map((t) => ({ value: t, label: t[0]!.toUpperCase() + t.slice(1) })),
  },
  {
    name: 'status',
    label: 'Status',
    kind: 'select',
    options: [
      { value: 'draft', label: 'Draft' },
      { value: 'published', label: 'Published' },
    ],
  },
  { name: 'publishedAt', label: 'Published at (IST)', kind: 'datetime' },
  { name: 'seoTitle', label: 'Search title', kind: 'text' },
  { name: 'seoDescription', label: 'Search description', kind: 'textarea' },
  { name: 'noindex', label: 'Hide from search engines and the sitemap', kind: 'checkbox' },
];

/** Menus: two levels. The editor posts JSON rows `{ label, href, external, children }`. */
const menuLink = z.object({ label: reqText(80), href, external: checkbox.optional() });
export const menuItemsSchema = z.preprocess(
  jsonInput,
  z.array(menuLink.extend({ children: z.array(menuLink).max(30).default([]) })).max(30),
);
export type MenuInput = z.output<typeof menuItemsSchema>;
export const menuKeySchema = slug;

export const MENU_ITEM_FIELDS: readonly FieldSpec[] = [
  { name: 'label', label: 'Label', kind: 'text', required: true },
  { name: 'href', label: 'Link', kind: 'url', required: true },
  { name: 'external', label: 'Opens another site', kind: 'checkbox' },
  {
    name: 'children',
    label: 'Sub-links',
    kind: 'items',
    fields: [
      { name: 'label', label: 'Label', kind: 'text', required: true },
      { name: 'href', label: 'Link', kind: 'url', required: true },
      { name: 'external', label: 'Opens another site', kind: 'checkbox' },
    ],
  },
];

export interface MenuNode {
  id: string;
  label: string;
  href: string;
  isExternal: boolean;
  children: MenuNode[];
}

/** Flat rows to a sorted two-level tree (rows whose parent is missing are dropped). */
export function menuTree(rows: readonly { id: string; parentId: string | null; label: string; href: string; position: number; isExternal: boolean }[]): MenuNode[] {
  const sorted = [...rows].sort((a, b) => a.position - b.position || a.label.localeCompare(b.label));
  const top = sorted.filter((r) => !r.parentId).map((r) => ({ id: r.id, label: r.label, href: r.href, isExternal: r.isExternal, children: [] as MenuNode[] }));
  const byId = new Map(top.map((n) => [n.id, n]));
  for (const r of sorted) if (r.parentId) byId.get(r.parentId)?.children.push({ id: r.id, label: r.label, href: r.href, isExternal: r.isExternal, children: [] });
  return top;
}
