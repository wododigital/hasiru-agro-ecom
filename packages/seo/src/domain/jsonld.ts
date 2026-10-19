import type { JsonLdBuilders, JsonLdNode, ProductJsonLdInput } from '@ecomkit/core/contracts';
import { canonicalUrl } from './paths';
import { absoluteUrl, type SiteIdentity } from './site';

const AVAILABILITY: Record<ProductJsonLdInput['availability'], string> = {
  in_stock: 'https://schema.org/InStock',
  preorder: 'https://schema.org/PreOrder',
  out_of_stock: 'https://schema.org/OutOfStock',
};

/** Paise to the decimal string schema.org prices use ("2499.00"). */
export const rupeesString = (paise: number): string => (Math.round(paise) / 100).toFixed(2);

/**
 * Text for a `<script type="application/ld+json">`: JSON with every `<`, `>`, `&` and line separator
 * unicode-escaped, so no string value can close the script element or open a comment.
 */
export function escapeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Drops null, undefined and empty arrays so nodes carry only what is known. */
function clean<T extends Record<string, unknown>>(node: T): T {
  return Object.fromEntries(Object.entries(node).filter(([, v]) => v != null && !(Array.isArray(v) && v.length === 0))) as T;
}

/** Builders for one site. Every node is plain data; `graph()` wraps them in one escaped @graph. */
export function createJsonLd(site: SiteIdentity): JsonLdBuilders {
  const url = (path: string) => canonicalUrl(site, path);
  const orgId = `${site.url}/#organization`;
  const logo = site.logo ? absoluteUrl(site, site.logo) : null;

  return {
    organization: () =>
      clean({
        '@type': 'Organization',
        '@id': orgId,
        name: site.name,
        url: url('/'),
        logo: logo ? { '@type': 'ImageObject', url: logo } : null,
        sameAs: site.sameAs,
        contactPoint:
          site.phone || site.email
            ? [clean({ '@type': 'ContactPoint', contactType: 'customer service', telephone: site.phone, email: site.email, areaServed: site.address?.addressCountry ?? 'IN' })]
            : null,
      }),

    website: () =>
      clean({
        '@type': 'WebSite',
        '@id': `${site.url}/#website`,
        url: url('/'),
        name: site.name,
        inLanguage: site.locales,
        publisher: { '@id': orgId },
        potentialAction: site.searchPath
          ? {
              '@type': 'SearchAction',
              target: { '@type': 'EntryPoint', urlTemplate: `${absoluteUrl(site, site.searchPath)}?q={search_term_string}` },
              'query-input': 'required name=search_term_string',
            }
          : null,
      }),

    localBusiness: () =>
      clean({
        '@type': site.businessType,
        '@id': `${site.url}/#localbusiness`,
        name: site.name,
        url: url('/'),
        image: logo,
        telephone: site.phone,
        email: site.email,
        priceRange: site.priceRange,
        address: site.address ? { '@type': 'PostalAddress', ...site.address } : null,
        geo: site.geo ? { '@type': 'GeoCoordinates', ...site.geo } : null,
        openingHours: site.openingHours,
        parentOrganization: { '@id': orgId },
      }),

    product: (p) => {
      const listSpec = { '@type': 'UnitPriceSpecification', price: rupeesString(p.pricePaise), priceCurrency: 'INR' };
      const bulkSpec = p.bulk
        ? {
            '@type': 'UnitPriceSpecification',
            price: rupeesString(p.bulk.unitPaise),
            priceCurrency: 'INR',
            eligibleQuantity: { '@type': 'QuantitativeValue', minValue: p.bulk.minQty, unitCode: 'C62' },
          }
        : null;
      return clean({
        '@type': 'Product',
        '@id': `${url(p.path)}#product`,
        name: p.name,
        url: url(p.path),
        sku: p.sku,
        description: p.description,
        image: p.images.map((i) => absoluteUrl(site, i)),
        brand: { '@type': 'Brand', name: site.name },
        additionalProperty: p.additionalProperties.map((a) => ({ '@type': 'PropertyValue', name: a.name, value: a.value })),
        offers: clean({
          '@type': 'Offer',
          url: url(p.path),
          priceCurrency: 'INR',
          price: rupeesString(p.pricePaise),
          priceValidUntil: p.priceValidUntil,
          availability: AVAILABILITY[p.availability],
          itemCondition: 'https://schema.org/NewCondition',
          seller: { '@id': orgId },
          priceSpecification: bulkSpec ? [listSpec, bulkSpec] : null,
          hasMerchantReturnPolicy: site.returnPolicy
            ? clean({
                '@type': 'MerchantReturnPolicy',
                applicableCountry: site.address?.addressCountry ?? 'IN',
                returnPolicyCategory:
                  site.returnPolicy.category === 'not_permitted'
                    ? 'https://schema.org/MerchantReturnNotPermitted'
                    : 'https://schema.org/MerchantReturnFiniteReturnWindow',
                merchantReturnDays: site.returnPolicy.category === 'window' ? site.returnPolicy.days : null,
              })
            : null,
        }),
        aggregateRating: p.rating
          ? { '@type': 'AggregateRating', ratingValue: Number(p.rating.average.toFixed(1)), reviewCount: p.rating.count, bestRating: 5, worstRating: 1 }
          : null,
        review: p.reviews.slice(0, 5).map((r) => ({
          '@type': 'Review',
          author: { '@type': 'Person', name: r.author },
          reviewRating: { '@type': 'Rating', ratingValue: r.rating, bestRating: 5, worstRating: 1 },
          reviewBody: r.body,
          datePublished: r.date,
        })),
      });
    },

    breadcrumbs: (items) => ({
      '@type': 'BreadcrumbList',
      itemListElement: items.map((item, i) => ({ '@type': 'ListItem', position: i + 1, name: item.name, item: url(item.path) })),
    }),

    faqPage: (items) => ({
      '@type': 'FAQPage',
      mainEntity: items.map((q) => ({ '@type': 'Question', name: q.question, acceptedAnswer: { '@type': 'Answer', text: q.answer } })),
    }),

    collectionPage: (c) => ({
      '@type': 'CollectionPage',
      name: c.name,
      url: url(c.path),
      isPartOf: { '@id': `${site.url}/#website` },
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: Math.min(c.items.length, 24),
        itemListElement: c.items.slice(0, 24).map((item, i) => ({ '@type': 'ListItem', position: i + 1, name: item.name, url: url(item.path) })),
      },
    }),

    article: (a) =>
      clean({
        '@type': 'Article',
        headline: a.headline.slice(0, 110),
        url: url(a.path),
        mainEntityOfPage: url(a.path),
        datePublished: a.datePublished,
        dateModified: a.dateModified,
        image: a.image ? [absoluteUrl(site, a.image)] : null,
        author: { '@id': orgId },
        publisher: { '@id': orgId },
      }),

    videoObject: (v) =>
      clean({
        '@type': 'VideoObject',
        name: v.name,
        description: v.description || v.name,
        thumbnailUrl: [absoluteUrl(site, v.thumbnailUrl)],
        uploadDate: v.uploadDate,
        contentUrl: v.contentUrl,
        embedUrl: v.embedUrl,
      }),

    graph: (nodes: readonly JsonLdNode[]) => escapeJsonLd({ '@context': 'https://schema.org', '@graph': nodes }),
  };
}
