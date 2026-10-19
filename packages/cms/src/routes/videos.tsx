import { Breadcrumbs } from '@ecomkit/ui';
import { VideoGrid } from '../ui';
import { cmsMetadata, cmsRuntime, JsonLdGraph, videosFor } from '../server';

export async function generateMetadata() {
  const m = cmsRuntime().messages.videos;
  return cmsMetadata({ title: m.title, description: m.description, path: '/videos' });
}

/** /videos: every published video, grouped by category, with VideoObject JSON-LD. */
export default async function VideosPage() {
  const rt = cmsRuntime();
  const m = rt.messages;
  const videos = await videosFor({ limit: 48 });
  const groups = new Map<string, typeof videos>();
  for (const v of videos) groups.set(v.category ?? '', [...(groups.get(v.category ?? '') ?? []), v]);
  const ld = rt.jsonLd?.();
  const nodes = ld
    ? videos
        .filter((v) => v.thumbnailUrl)
        .slice(0, 20)
        .map((v) => ld.videoObject({ name: v.title, description: v.description ?? v.title, thumbnailUrl: v.thumbnailUrl!, uploadDate: v.uploadDate, contentUrl: v.contentUrl, embedUrl: v.embedUrl }))
    : [];
  return (
    <>
      <JsonLdGraph crumbs={[{ name: m.breadcrumbs.home, path: '/' }, { name: m.breadcrumbs.videos, path: '/videos' }]} nodes={nodes} />
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6">
        <Breadcrumbs items={[{ label: m.breadcrumbs.home, href: '/' }, { label: m.breadcrumbs.videos }]} />
        <h1 className="font-display text-4xl text-primary md:text-5xl">{m.videos.title}</h1>
        {m.videos.description ? <p className="max-w-2xl text-lg text-muted">{m.videos.description}</p> : null}
        {videos.length ? (
          [...groups].map(([category, list]) => (
            <section key={category || 'other'} className="flex flex-col gap-4">
              {groups.size > 1 ? <h2 className="font-display text-2xl text-primary">{category || m.videos.other}</h2> : null}
              <VideoGrid videos={list} messages={m} />
            </section>
          ))
        ) : (
          <p className="text-muted">{m.videos.empty}</p>
        )}
      </main>
    </>
  );
}
