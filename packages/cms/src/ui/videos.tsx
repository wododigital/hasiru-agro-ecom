import { ImageWithFallback } from '@ecomkit/ui';
import type { CmsMessages } from '../messages';
import type { VideoView } from '../server/queries';

/**
 * Video cards: poster plus a link out to the video. No third-party iframe or thumbnail on the page, so the
 * storefront CSP stays self-only and nothing heavy loads until the visitor asks for it.
 */
export function VideoGrid({ videos, messages: m }: { videos: readonly VideoView[]; messages: CmsMessages }) {
  return (
    <ul className="grid gap-5 sm:grid-cols-2 md:grid-cols-3">
      {videos.map((v) => (
        <li key={v.id}>
          <a href={v.url} target="_blank" rel="noopener noreferrer" data-cta="cms-video-watch" className="group flex h-full flex-col overflow-hidden rounded-lg bg-surface shadow-card">
            <span className="relative block aspect-video bg-surface-2">
              <ImageWithFallback image={v.poster} alt="" fill sizes="(min-width: 768px) 33vw, 100vw" className="object-cover transition-transform group-hover:scale-[1.02]" />
              <span aria-hidden="true" className="absolute inset-0 grid place-items-center">
                <span className="grid size-14 place-items-center rounded-full bg-primary/85 text-primary-fg">
                  <svg viewBox="0 0 24 24" className="ml-1 size-6 fill-current" focusable="false">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </span>
              </span>
            </span>
            <span className="flex flex-col gap-1 p-4">
              <span className="font-semibold text-primary">{v.title}</span>
              {v.description ? <span className="line-clamp-2 text-sm text-muted">{v.description}</span> : null}
              <span className="mt-1 text-sm font-medium text-primary-hover underline-offset-4 group-hover:underline">
                {m.videos.watch[v.kind]}
                <span className="sr-only">{m.videos.opensNewTab}</span>
              </span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
