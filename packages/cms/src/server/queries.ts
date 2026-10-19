import type { ImageRef, SitemapEntry } from '@ecomkit/core/contracts';
import { tags } from '@ecomkit/core/cache-tags';
import { db } from '@ecomkit/core/db';
import { safeHtml } from '@ecomkit/core/validation';
import { and, asc, desc, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import { pagePath, videoLinks } from '../domain';
import { cmsClient, cmsCounter, cmsPortfolioItem, cmsPost, cmsTeamMember, cmsTestimonial, cmsTrustClaim, cmsVideo, type CmsPost, type CmsVideo } from '../schema';
import { cacheFor } from './cache';
import { publishedPages } from './pages';
import { imagesFor } from './runtime';

const published = <T extends { status: unknown }>(t: T) => eq(t.status as never, 'published');

// ---- videos ------------------------------------------------------------------

export interface VideoView {
  id: string;
  title: string;
  description: string | null;
  url: string;
  kind: CmsVideo['kind'];
  category: string | null;
  poster: ImageRef | null;
  embedUrl: string | null;
  contentUrl: string | null;
  /** Poster image URL for JSON-LD (media poster, else the YouTube thumbnail). */
  thumbnailUrl: string | null;
  uploadDate: string;
}

type VideoFilter = { by: 'all' } | { by: 'ids'; ids: readonly string[] } | { by: 'product' | 'model' | 'category'; value: string };

/** Cached read; the filter is plain data so it can be part of the cache key. */
async function videoRows(filter: VideoFilter, limit: number): Promise<CmsVideo[]> {
  'use cache';
  cacheFor([tags.cms('videos')]);
  const where =
    filter.by === 'ids'
      ? inArray(cmsVideo.id, [...filter.ids])
      : filter.by === 'product'
        ? eq(cmsVideo.productId, filter.value)
        : filter.by === 'model'
          ? eq(cmsVideo.modelSlug, filter.value)
          : filter.by === 'category'
            ? eq(cmsVideo.category, filter.value)
            : undefined;
  return db
    .select()
    .from(cmsVideo)
    .where(and(published(cmsVideo), where))
    .orderBy(asc(cmsVideo.position), desc(cmsVideo.createdAt))
    .limit(limit);
}

export async function toVideoViews(rows: readonly CmsVideo[]): Promise<VideoView[]> {
  const images = await imagesFor(rows.map((r) => r.posterMediaId));
  return rows.map((r) => {
    const links = videoLinks(r.kind, r.url);
    const poster = r.posterMediaId ? (images[r.posterMediaId] ?? null) : null;
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      url: r.url,
      kind: r.kind,
      category: r.category,
      poster,
      embedUrl: links.embedUrl,
      contentUrl: links.contentUrl,
      thumbnailUrl: poster?.src ?? links.thumbnailUrl,
      uploadDate: r.createdAt.toISOString(),
    };
  });
}

/**
 * Published videos for a product page, a planting model page, a category, or explicit ids (kept in that order).
 * The one video lookup every module uses (`videosFor` in the plan).
 */
export async function videosFor(input: { productId?: string; modelSlug?: string; category?: string; ids?: readonly string[]; limit?: number }): Promise<VideoView[]> {
  const limit = Math.min(input.limit ?? 12, 48);
  let rows: CmsVideo[];
  if (input.ids?.length) {
    const found = await videoRows({ by: 'ids', ids: input.ids }, 48);
    const byId = new Map(found.map((r) => [r.id, r]));
    rows = input.ids.map((id) => byId.get(id)).filter((r): r is CmsVideo => Boolean(r)).slice(0, limit);
  } else if (input.productId) rows = await videoRows({ by: 'product', value: input.productId }, limit);
  else if (input.modelSlug) rows = await videoRows({ by: 'model', value: input.modelSlug }, limit);
  else if (input.category) rows = await videoRows({ by: 'category', value: input.category }, limit);
  else rows = await videoRows({ by: 'all' }, limit);
  return toVideoViews(rows);
}

// ---- guides ------------------------------------------------------------------

/**
 * Published guides whose date has passed. Cached for hours, not days, so a guide scheduled for later appears
 * within the hour without an admin save.
 */
export async function listPosts(limit = 100): Promise<CmsPost[]> {
  'use cache';
  cacheFor([tags.cms('guides')], 'hours');
  return db
    .select()
    .from(cmsPost)
    .where(and(published(cmsPost), isNotNull(cmsPost.publishedAt), lte(cmsPost.publishedAt, new Date())))
    .orderBy(desc(cmsPost.publishedAt), desc(cmsPost.id))
    .limit(limit);
}

export async function getPost(slug: string): Promise<CmsPost | null> {
  'use cache';
  cacheFor([tags.cms('guides'), tags.cms(`guide_${slug}`)], 'hours');
  const [row] = await db
    .select()
    .from(cmsPost)
    .where(and(eq(cmsPost.slug, slug), published(cmsPost), lte(cmsPost.publishedAt, new Date())))
    .limit(1);
  return row ? { ...row, bodyHtml: safeHtml(row.bodyHtml) } : null;
}

// ---- the rest (published / verified / shown only) ------------------------------

export async function listTestimonials(limit = 24) {
  'use cache';
  cacheFor([tags.cms('testimonials')]);
  return db.select().from(cmsTestimonial).where(published(cmsTestimonial)).orderBy(asc(cmsTestimonial.position), desc(cmsTestimonial.createdAt)).limit(limit);
}

export async function listTeam() {
  'use cache';
  cacheFor([tags.cms('team')]);
  return db.select().from(cmsTeamMember).where(published(cmsTeamMember)).orderBy(asc(cmsTeamMember.position), asc(cmsTeamMember.name));
}

/** Only counters an admin marked verified ever reach the storefront. */
export async function listCounters() {
  'use cache';
  cacheFor([tags.cms('counters')]);
  return db.select().from(cmsCounter).where(eq(cmsCounter.verified, true)).orderBy(asc(cmsCounter.position), asc(cmsCounter.key));
}

/** Only claims with `show` (a "Rated 4.8" stays hidden until confirmed). */
export async function listTrustClaims() {
  'use cache';
  cacheFor([tags.cms('trust')]);
  return db.select().from(cmsTrustClaim).where(eq(cmsTrustClaim.show, true)).orderBy(asc(cmsTrustClaim.position), asc(cmsTrustClaim.key));
}

export async function listPortfolio() {
  'use cache';
  cacheFor([tags.cms('portfolio')]);
  return db.select().from(cmsPortfolioItem).where(published(cmsPortfolioItem)).orderBy(asc(cmsPortfolioItem.position), asc(cmsPortfolioItem.title));
}

export async function getPortfolioItem(slug: string) {
  'use cache';
  cacheFor([tags.cms('portfolio')]);
  const [row] = await db
    .select()
    .from(cmsPortfolioItem)
    .where(and(eq(cmsPortfolioItem.slug, slug), published(cmsPortfolioItem)))
    .limit(1);
  return row ? { ...row, bodyHtml: safeHtml(row.bodyHtml) } : null;
}

export async function listClients() {
  'use cache';
  cacheFor([tags.cms('clients')]);
  return db.select().from(cmsClient).where(published(cmsClient)).orderBy(asc(cmsClient.position), asc(cmsClient.name));
}

// ---- sitemap sources ---------------------------------------------------------------

/** `pages`: published, indexable cms pages (policies only once published), plus /guides and /videos when they have content. */
export async function pageEntries(): Promise<SitemapEntry[]> {
  const [pages, posts, videos] = await Promise.all([publishedPages(), listPosts(1), videoRows({ by: 'all' }, 1)]);
  const entries: SitemapEntry[] = pages.filter((p) => !p.noindex).map((p) => ({ path: pagePath(p.slug), lastModified: p.updatedAt.toISOString(), changeFrequency: 'monthly' }));
  if (posts.length) entries.push({ path: '/guides', lastModified: posts[0]!.updatedAt.toISOString(), changeFrequency: 'weekly' });
  if (videos.length) entries.push({ path: '/videos', changeFrequency: 'weekly' });
  return entries;
}

/** `guides`: published, indexable, already-dated guides. */
export async function guideEntries(): Promise<SitemapEntry[]> {
  return (await listPosts(5000)).filter((p) => !p.noindex).map((p) => ({ path: `/guides/${p.slug}`, lastModified: p.updatedAt.toISOString(), changeFrequency: 'monthly' }));
}
