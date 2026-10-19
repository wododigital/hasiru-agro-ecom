import type { ImageRef, JsonLdNode } from '@ecomkit/core/contracts';
import { blockMediaIds, type Block } from '../domain';
import type { CmsCounter, CmsTeamMember, CmsTestimonial, CmsTrustClaim } from '../schema';
import { listCounters, listTeam, listTestimonials, listTrustClaims, videosFor, type VideoView } from './queries';
import { cmsRuntime, imagesFor } from './runtime';

/** Everything the block components need, loaded once per page (only for block types present). */
export interface BlockContext {
  images: Record<string, ImageRef>;
  /** Index-aligned with the blocks; filled for `video` blocks. */
  videos: Record<number, VideoView[]>;
  testimonials: CmsTestimonial[];
  counters: CmsCounter[];
  trust: CmsTrustClaim[];
  team: CmsTeamMember[];
}

export async function resolveBlocks(blocks: readonly Block[]): Promise<BlockContext> {
  const has = (t: Block['type']) => blocks.some((b) => b.type === t);
  const [testimonials, counters, trust, team, videoLists] = await Promise.all([
    has('testimonials') ? listTestimonials(24) : [],
    has('counters') ? listCounters() : [],
    has('trust_band') ? listTrustClaims() : [],
    has('team') ? listTeam() : [],
    Promise.all(
      blocks.map((b, i) =>
        b.type === 'video' ? videosFor({ ids: b.data.videoIds.length ? b.data.videoIds : undefined, category: b.data.category, limit: b.data.limit ?? 6 }).then((v) => [i, v] as const) : null,
      ),
    ),
  ]);
  const images = await imagesFor([
    ...blockMediaIds(blocks),
    ...trust.map((t) => t.logoMediaId),
    ...team.map((t) => t.photoMediaId),
    ...testimonials.map((t) => t.photoMediaId),
  ]);
  const videos: Record<number, VideoView[]> = {};
  for (const entry of videoLists) if (entry) videos[entry[0]] = entry[1];
  return { images, videos, testimonials, counters, trust, team };
}

/**
 * JSON-LD for a page's blocks: FAQPage for rendered FAQ blocks, VideoObject for each listed video (needs a
 * thumbnail). Empty when the seo capability is not bound.
 */
export function blockJsonLd(blocks: readonly Block[], ctx: BlockContext): JsonLdNode[] {
  const ld = cmsRuntime().jsonLd?.();
  if (!ld) return [];
  const nodes: JsonLdNode[] = [];
  const faqs = blocks.flatMap((b) => (b.type === 'faq' ? b.data.items : []));
  if (faqs.length) nodes.push(ld.faqPage(faqs));
  for (const list of Object.values(ctx.videos)) {
    for (const v of list) {
      if (!v.thumbnailUrl) continue;
      nodes.push(ld.videoObject({ name: v.title, description: v.description ?? v.title, thumbnailUrl: v.thumbnailUrl, uploadDate: v.uploadDate, contentUrl: v.contentUrl, embedUrl: v.embedUrl }));
    }
  }
  return nodes;
}
