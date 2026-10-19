'use client';

import type { ImageRef } from '@ecomkit/core/contracts';
import { Leaf } from 'lucide-react';
import Image, { type ImageProps } from 'next/image';
import { useState } from 'react';
import { cn } from '../cn';
import { uiMessages } from '../messages';

export type ImageWithFallbackProps = Omit<ImageProps, 'src' | 'alt' | 'width' | 'height' | 'placeholder' | 'blurDataURL'> & {
  /** A media ImageRef, or null when the product has no image yet. */
  image: ImageRef | null;
  /** Overrides image.alt (e.g. decorative use: ""). */
  alt?: string;
  /** Accessible text for the leaf placeholder. */
  fallbackLabel?: string;
};

/**
 * The one image renderer: next/image (AVIF/WebP, sizes, blur placeholder) with a leaf placeholder
 * when there is no image or it fails to load. Pass `preload` on the single LCP image of a page.
 */
export function ImageWithFallback({ image, alt, fallbackLabel = uiMessages.image.fallback, className, fill, ...rest }: ImageWithFallbackProps) {
  const [failed, setFailed] = useState(false);
  if (!image || failed) {
    return (
      <div
        role="img"
        aria-label={fallbackLabel}
        className={cn('grid place-items-center bg-surface-2 text-primary-hover/60', fill && 'absolute inset-0', className)}
        style={fill ? undefined : { aspectRatio: image ? `${image.width} / ${image.height}` : '1 / 1' }}
      >
        <Leaf aria-hidden="true" className="size-1/4 max-h-16 max-w-16" />
      </div>
    );
  }
  return (
    <Image
      src={image.src}
      alt={alt ?? image.alt}
      {...(fill ? { fill: true } : { width: image.width, height: image.height })}
      {...(image.blurDataURL ? { placeholder: 'blur' as const, blurDataURL: image.blurDataURL } : {})}
      onError={() => setFailed(true)}
      className={className}
      {...rest}
    />
  );
}
