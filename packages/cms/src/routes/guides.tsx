import { GuideList } from '../ui';
import { cmsMetadata, cmsRuntime, imagesFor, JsonLdGraph, listPosts } from '../server';

export async function generateMetadata() {
  const m = cmsRuntime().messages.guides;
  return cmsMetadata({ title: m.title, description: m.description, path: '/guides' });
}

/** /guides: every published guide, newest first. */
export default async function GuidesPage() {
  const rt = cmsRuntime();
  const posts = await listPosts();
  const covers = await imagesFor(posts.map((p) => p.coverMediaId));
  const ld = rt.jsonLd?.();
  const crumbs = [{ label: rt.messages.breadcrumbs.home, href: '/' }, { label: rt.messages.breadcrumbs.guides }];
  return (
    <>
      <JsonLdGraph
        crumbs={[{ name: crumbs[0]!.label, path: '/' }, { name: crumbs[1]!.label, path: '/guides' }]}
        nodes={ld && posts.length ? [ld.collectionPage({ name: rt.messages.guides.title, path: '/guides', items: posts.map((p) => ({ name: p.title, path: `/guides/${p.slug}` })) })] : []}
      />
      <GuideList posts={posts} covers={covers} messages={rt.messages} crumbs={crumbs} />
    </>
  );
}
