import { notFound } from 'next/navigation';
import { cmsMetadata, GuideArticle, JsonLdGraph, NO_PAGE } from '../ui';
import { cmsRuntime, getPost, imagesFor, listPosts } from '../server';

type Props = { params: Promise<{ slug: string }> };

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  try {
    const list = (await listPosts()).map((p) => ({ slug: p.slug }));
    return list.length ? list : [{ slug: NO_PAGE }];
  } catch {
    return [{ slug: NO_PAGE }];
  }
}

export async function generateMetadata({ params }: Props) {
  const post = await getPost((await params).slug);
  if (!post) return {};
  const cover = post.coverMediaId ? ((await imagesFor([post.coverMediaId]))[post.coverMediaId] ?? null) : null;
  return cmsMetadata({ title: post.seoTitle || post.title, description: post.seoDescription || post.excerpt || '', path: `/guides/${post.slug}`, noindex: post.noindex, type: 'article', image: cover });
}

/** /guides/<slug>: one published guide with Article JSON-LD. */
export default async function GuidePage({ params }: Props) {
  const { slug } = await params;
  const post = slug === NO_PAGE ? null : await getPost(slug);
  if (!post) notFound();
  const rt = cmsRuntime();
  const cover = post.coverMediaId ? ((await imagesFor([post.coverMediaId]))[post.coverMediaId] ?? null) : null;
  const m = rt.messages.breadcrumbs;
  const path = `/guides/${post.slug}`;
  const ld = rt.jsonLd?.();
  return (
    <>
      <JsonLdGraph
        crumbs={[{ name: m.home, path: '/' }, { name: m.guides, path: '/guides' }, { name: post.title, path }]}
        nodes={ld ? [ld.article({ headline: post.title, path, datePublished: (post.publishedAt ?? post.createdAt).toISOString(), dateModified: post.updatedAt.toISOString(), image: cover?.src ?? null })] : []}
      />
      <GuideArticle post={post} cover={cover} messages={rt.messages} crumbs={[{ label: m.home, href: '/' }, { label: m.guides, href: '/guides' }, { label: post.title }]} />
    </>
  );
}
