import type { ImageRef } from '@ecomkit/core/contracts';
import { Breadcrumbs, ImageWithFallback, type Crumb } from '@ecomkit/ui';
import Link from 'next/link';
import type { CmsMessages } from '../messages';
import type { CmsPost } from '../schema';

const dateIN = (d: Date | null) => (d ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'long', timeZone: 'Asia/Kolkata' }).format(d) : '');

export function GuideList({ posts, covers, messages: m, crumbs }: { posts: readonly CmsPost[]; covers: Record<string, ImageRef>; messages: CmsMessages; crumbs: readonly Crumb[] }) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6">
      <Breadcrumbs items={crumbs} />
      <h1 className="font-display text-4xl text-primary md:text-5xl">{m.guides.title}</h1>
      {m.guides.description ? <p className="max-w-2xl text-lg text-muted">{m.guides.description}</p> : null}
      {posts.length ? (
        <ul className="grid gap-5 sm:grid-cols-2 md:grid-cols-3">
          {posts.map((p) => (
            <li key={p.id}>
              <Link href={`/guides/${p.slug}`} data-cta="guides-card" className="flex h-full flex-col overflow-hidden rounded-lg bg-surface shadow-card">
                <span className="relative block aspect-[16/10]">
                  <ImageWithFallback image={p.coverMediaId ? (covers[p.coverMediaId] ?? null) : null} alt="" fill sizes="(min-width: 768px) 33vw, 100vw" className="object-cover" />
                </span>
                <span className="flex flex-col gap-2 p-4">
                  <span className="text-lg font-semibold text-primary">{p.title}</span>
                  {p.excerpt ? <span className="line-clamp-3 text-sm text-muted">{p.excerpt}</span> : null}
                  <span className="mt-auto text-sm font-medium text-primary-hover">{m.guides.readMore}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">{m.guides.empty}</p>
      )}
    </main>
  );
}

export function GuideArticle({ post, cover, messages: m, crumbs }: { post: CmsPost; cover: ImageRef | null; messages: CmsMessages; crumbs: readonly Crumb[] }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6">
      <Breadcrumbs items={crumbs} />
      <article className="flex flex-col gap-5">
        <header className="flex flex-col gap-3">
          <h1 className="font-display text-4xl text-primary md:text-5xl">{post.title}</h1>
          <p className="text-sm text-muted">
            {post.author ? `${m.guides.by} ${post.author} · ` : ''}
            {post.publishedAt ? `${m.guides.published} ${dateIN(post.publishedAt)}` : ''}
          </p>
        </header>
        {cover ? <ImageWithFallback image={cover} preload sizes="(min-width: 768px) 768px, 100vw" className="h-auto w-full rounded-lg" /> : null}
        {/* eslint-disable-next-line react/no-danger -- sanitised with core safeHtml on save and on read */}
        <div className="[&_a]:text-primary-hover [&_a]:underline [&_h2]:mt-6 [&_h2]:font-display [&_h2]:text-2xl [&_li]:ml-5 [&_ol]:list-decimal [&_p]:my-3 [&_ul]:list-disc" dangerouslySetInnerHTML={{ __html: post.bodyHtml }} />
      </article>
    </main>
  );
}
