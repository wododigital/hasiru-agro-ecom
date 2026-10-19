import 'server-only';

import type { JsonLdBuilders } from '@ecomkit/core/contracts';
import { canonicalUrl, createJsonLd } from '../domain';
import { seoRuntime } from './runtime';

export { configureSeo, seoRuntime, type EntitySeo, type OgCard, type SeoRegistry, type SeoRuntime, type SeoRuntimeInput } from './runtime';
export {
  addRedirect,
  background,
  listRedirects,
  recordRedirectHit,
  redirectFor,
  RedirectError,
  removeRedirect,
  resetRedirectCache,
  type AddRedirectOptions,
  type ListRedirectsInput,
  type RedirectSource,
  type RedirectStatus,
} from './redirects';
export { dismissNotFound, fixNotFound, listNotFound, logNotFound, pruneNotFound, resolveMissing, type ListNotFoundInput } from './not-found';
export { buildMetadata, deletePageMeta, getPageMeta, listPageMeta, noindexPaths, PAGE_META_TAG, pageMetadata, savePageMeta, type PageMetaInput } from './page-meta';
export { llmsResponse, ogCardFor, ogResponse, robotsResponse, sitemapFileResponse, sitemapFiles, sitemapIndexResponse, titleFromPath } from './files';

/** JSON-LD builders for the bound site identity (the `jsonLd.*` the plan names). */
export function jsonLd(): JsonLdBuilders {
  return createJsonLd(seoRuntime().site);
}

/** Absolute canonical URL on the bound site (`?page=n` kept for n > 1). */
export function canonical(path: string, options: { page?: number } = {}): string {
  return canonicalUrl(seoRuntime().site, path, options);
}
