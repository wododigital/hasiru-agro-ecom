import type { JsonLdNode, MetadataInput } from '@ecomkit/core/contracts';
import type { Crumb } from '@ecomkit/ui';
import type { Metadata } from 'next';
import { pagePath } from '../domain';
import { PageView } from '../ui/PageView';
import type { PageWithBlocks } from './pages';
import { blockJsonLd, resolveBlocks } from './render';
import { cmsRuntime } from './runtime';

/** Placeholder param when nothing is published yet (Cache Components needs at least one static param). */
export const NO_PAGE = '__no-page';

/** Metadata through the bound seo builder, or a plain title when seo is off. */
export function cmsMetadata(input: MetadataInput): Metadata {
  const build = cmsRuntime().metadata;
  if (build) return build(input);
  return { title: input.title, description: input.description || undefined, robots: input.noindex ? { index: false, follow: true } : undefined };
}

export function pageMetadataFor(data: PageWithBlocks | null): Metadata {
  if (!data) return {};
  const p = data.page;
  return cmsMetadata({ title: p.seoTitle || p.title, description: p.seoDescription ?? '', path: pagePath(p.slug), noindex: p.noindex });
}

/** One escaped @graph per page: Organization + WebSite, breadcrumbs, then the page's own nodes. */
export function JsonLdGraph({ nodes, crumbs }: { nodes: readonly JsonLdNode[]; crumbs: readonly { name: string; path: string }[] }) {
  const ld = cmsRuntime().jsonLd?.();
  if (!ld) return null;
  const graph = ld.graph([ld.organization(), ld.website(), ...(crumbs.length > 1 ? [ld.breadcrumbs(crumbs)] : []), ...nodes]);
  // eslint-disable-next-line react/no-danger -- graph() returns escaped JSON
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: graph }} />;
}

/** Renders a published page (blocks resolved, JSON-LD included). `trail` sits between Home and the page. */
export async function CmsPageBody({ data, trail = [], localBusiness = false }: { data: PageWithBlocks; trail?: readonly Crumb[]; localBusiness?: boolean }) {
  const m = cmsRuntime().messages;
  const ctx = await resolveBlocks(data.blocks);
  const path = pagePath(data.page.slug);
  const crumbs: Crumb[] = [{ label: m.breadcrumbs.home, href: '/' }, ...trail, { label: data.page.title }];
  const ld = cmsRuntime().jsonLd?.();
  const nodes = [...(localBusiness && ld ? [ld.localBusiness()] : []), ...blockJsonLd(data.blocks, ctx)];
  return (
    <>
      <JsonLdGraph nodes={nodes} crumbs={crumbs.filter((c, i) => c.href || i === crumbs.length - 1).map((c) => ({ name: c.label, path: c.href ?? path }))} />
      <PageView title={data.page.title} blocks={data.blocks} ctx={ctx} messages={m} crumbs={crumbs} landing={data.page.template === 'landing'} />
    </>
  );
}
