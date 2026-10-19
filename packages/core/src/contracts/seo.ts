import type { ImageRef } from './media';
import type { Locale } from './common';

export interface MetadataInput {
  title: string;
  description: string;
  /** Path on the canonical host, no trailing slash, no query. */
  path: string;
  image?: ImageRef | string | null;
  noindex?: boolean;
  type?: 'website' | 'article' | 'product';
  locale?: Locale;
  /** Paginated listings keep `?page=n` in their own canonical. */
  page?: number;
}

export type JsonLdNode = Readonly<Record<string, unknown>> & { readonly '@type': string };

export interface ProductJsonLdInput {
  name: string;
  path: string;
  sku: string;
  description: string;
  images: readonly string[];
  pricePaise: number;
  priceValidUntil: string;
  availability: 'in_stock' | 'preorder' | 'out_of_stock';
  bulk: { minQty: number; unitPaise: number } | null;
  rating: { average: number; count: number } | null;
  reviews: readonly { author: string; rating: number; body: string; date: string }[];
  additionalProperties: readonly { name: string; value: string }[];
}

/** Implemented by `@ecomkit/seo` (`jsonLd.*`). `graph()` returns script text already escaped (`<` -> `<`). */
export interface JsonLdBuilders {
  organization(): JsonLdNode;
  website(): JsonLdNode;
  localBusiness(): JsonLdNode;
  product(input: ProductJsonLdInput): JsonLdNode;
  breadcrumbs(items: readonly { name: string; path: string }[]): JsonLdNode;
  faqPage(items: readonly { question: string; answer: string }[]): JsonLdNode;
  collectionPage(input: { name: string; path: string; items: readonly { name: string; path: string }[] }): JsonLdNode;
  article(input: { headline: string; path: string; datePublished: string; dateModified: string; image: string | null }): JsonLdNode;
  videoObject(input: { name: string; description: string; thumbnailUrl: string; uploadDate: string; contentUrl: string | null; embedUrl: string | null }): JsonLdNode;
  graph(nodes: readonly JsonLdNode[]): string;
}
