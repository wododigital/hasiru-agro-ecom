import type { ImageRef } from '@ecomkit/core/contracts';
import { ImageWithFallback } from '@ecomkit/ui';
import type { CatalogMessages } from '../messages';

/** Main image plus a scroll-snap strip (no JS); credits listed when a licence asks for them. */
export function Gallery({ images, name, messages }: { images: readonly ImageRef[]; name: string; messages: CatalogMessages }) {
  const m = messages.pdp;
  const credits = [...new Set(images.flatMap((i) => (i.credit ? [i.credit] : [])))];
  return (
    <section aria-label={m.gallery} className="flex flex-col gap-2">
      {images.length ? (
        <ul className="flex snap-x snap-mandatory gap-2 overflow-x-auto rounded-lg">
          {images.map((img, i) => (
            <li key={img.id} id={`image-${i + 1}`} className="relative aspect-square w-full shrink-0 snap-center overflow-hidden rounded-lg bg-surface-2">
              <ImageWithFallback image={img} fill sizes="(min-width: 1024px) 50vw, 100vw" className="object-cover" preload={i === 0} loading={i === 0 ? 'eager' : 'lazy'} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="relative aspect-square w-full overflow-hidden rounded-lg">
          <ImageWithFallback image={null} alt={name} fill />
        </div>
      )}
      {images.length > 1 ? (
        <ol className="flex gap-2 overflow-x-auto">
          {images.map((img, i) => (
            <li key={img.id} className="relative size-16 shrink-0 overflow-hidden rounded-sm border border-border">
              <a href={`#image-${i + 1}`} aria-label={img.alt} data-cta="pdp-gallery-thumb">
                <ImageWithFallback image={img} alt="" fill sizes="64px" className="object-cover" />
              </a>
            </li>
          ))}
        </ol>
      ) : null}
      {credits.length ? (
        <p className="text-xs text-muted">
          {credits.map((c) => (
            <span key={c} className="block">
              {m.imageCredit(c)}
            </span>
          ))}
        </p>
      ) : null}
    </section>
  );
}
