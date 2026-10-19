import { z } from 'zod';

/**
 * Who the store is, for metadata and JSON-LD. Host config (the app passes it to `configureSeo`);
 * nothing store-specific lives in this package.
 */
export const siteIdentitySchema = z.object({
  /** Canonical origin, e.g. https://www.example.com (no trailing slash). */
  url: z.url(),
  name: z.string().min(1),
  description: z.string().default(''),
  /** Absolute or root-relative logo URL. */
  logo: z.string().nullable().default(null),
  sameAs: z.array(z.url()).default([]),
  phone: z.string().nullable().default(null),
  email: z.string().nullable().default(null),
  /** schema.org LocalBusiness subtype, e.g. Store, GardenStore. */
  businessType: z.string().default('Store'),
  address: z
    .object({
      streetAddress: z.string(),
      addressLocality: z.string(),
      addressRegion: z.string(),
      postalCode: z.string(),
      addressCountry: z.string().default('IN'),
    })
    .nullable()
    .default(null),
  geo: z.object({ latitude: z.number(), longitude: z.number() }).nullable().default(null),
  /** schema.org openingHours strings, e.g. "Mo-Sa 08:00-18:00". */
  openingHours: z.array(z.string()).default([]),
  priceRange: z.string().nullable().default(null),
  /** Offer.hasMerchantReturnPolicy; null leaves it out. */
  returnPolicy: z
    .discriminatedUnion('category', [z.object({ category: z.literal('not_permitted') }), z.object({ category: z.literal('window'), days: z.int().min(1) })])
    .nullable()
    .default(null),
  /** Path of the site search page; emits the WebSite SearchAction when set. */
  searchPath: z.string().nullable().default(null),
  /** Locales with routes; `kn-IN` adds hreflang alternates under /kn. */
  locales: z.array(z.enum(['en-IN', 'kn-IN'])).default(['en-IN']),
});

export type SiteIdentity = z.output<typeof siteIdentitySchema>;
export type SiteIdentityInput = z.input<typeof siteIdentitySchema>;

export function siteIdentity(input: SiteIdentityInput): SiteIdentity {
  const site = siteIdentitySchema.parse(input);
  return { ...site, url: site.url.replace(/\/+$/, '') };
}

/** Absolute URL on the site for a root-relative path (absolute URLs pass through). */
export function absoluteUrl(site: Pick<SiteIdentity, 'url'>, pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${site.url}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}
