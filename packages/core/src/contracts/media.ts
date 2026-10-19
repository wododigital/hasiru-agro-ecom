/** A rendered image reference. `src` is a media path that `ui/ImageWithFallback` hands to next/image. */
export interface ImageRef {
  id: string;
  src: string;
  alt: string;
  width: number;
  height: number;
  blurDataURL: string | null;
  /** Attribution text when the licence requires it (Wikimedia CC-BY etc.). */
  credit: string | null;
}
