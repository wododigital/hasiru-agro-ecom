// Pure media rules: byte sniffing, derivative planning, storage keys and URLs, the next/image loader.
import { z } from 'zod';

/** Upload cap; matches nginx `client_max_body_size 12m`. */
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
/** Decoded pixel cap (decompression bombs). */
export const MAX_INPUT_PIXELS = 50_000_000;
/** Masters are normalised to WebP and fit inside this box (never enlarged). */
export const MASTER_MAX_PX = 2560;
/** One width ladder for every image: product cards and PDP use the low end, site banners the high end. */
export const DERIVATIVE_WIDTHS = [160, 320, 480, 640, 800, 960, 1280, 1920] as const;
export const QUALITY = { master: 90, avif: 50, webp: 75, jpeg: 80, blur: 40 } as const;
export const BLUR_PX = 16;
export const SIGNED_URL_TTL_SEC = 600;

// ---- sniffing ----------------------------------------------------------------

export type Sniffed =
  | { kind: 'image'; mime: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | 'image/avif'; ext: string }
  | { kind: 'document'; mime: 'application/pdf'; ext: 'pdf' }
  | { kind: 'refused'; reason: 'svg' | 'heic' | 'unknown' };

const ascii = (b: Uint8Array, start: number, end: number) => String.fromCharCode(...b.subarray(start, end));

/** Decides the file type from its bytes only. The client's name and Content-Type are never trusted. */
export function sniff(bytes: Uint8Array): Sniffed {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'image', mime: 'image/jpeg', ext: 'jpg' };
  if (b.length >= 8 && ascii(b, 0, 8) === '\x89PNG\r\n\x1a\n') return { kind: 'image', mime: 'image/png', ext: 'png' };
  if (b.length >= 6 && /^GIF8[79]a$/.test(ascii(b, 0, 6))) return { kind: 'image', mime: 'image/gif', ext: 'gif' };
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return { kind: 'image', mime: 'image/webp', ext: 'webp' };
  if (b.length >= 12 && ascii(b, 4, 8) === 'ftyp') {
    const brand = ascii(b, 8, 12);
    if (brand === 'avif' || brand === 'avis') return { kind: 'image', mime: 'image/avif', ext: 'avif' };
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return { kind: 'refused', reason: 'heic' };
  }
  if (b.length >= 5 && ascii(b, 0, 5) === '%PDF-') return { kind: 'document', mime: 'application/pdf', ext: 'pdf' };
  const head = new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(0, 2048)).replace(/^\uFEFF/, '').trimStart();
  if (head.startsWith('<') && /<svg[\s>/]/i.test(head)) return { kind: 'refused', reason: 'svg' };
  return { kind: 'refused', reason: 'unknown' };
}

// ---- derivatives -------------------------------------------------------------

/** Widths to generate for a master: the ladder up to the master width, never enlarged. A master narrower than the ladder gets one derivative at its own width. */
export function planWidths(masterWidth: number): number[] {
  const widths = DERIVATIVE_WIDTHS.filter((w) => w <= masterWidth);
  return widths.length ? widths : [Math.max(1, Math.floor(masterWidth))];
}

export type DerivativeFormat = 'avif' | 'webp';

/** Smallest stored width >= wanted (else the largest), in AVIF when the browser accepts it and it exists, else WebP. */
export function pickDerivative(
  available: readonly { width: number; format: DerivativeFormat }[],
  wanted: number,
  acceptsAvif: boolean,
): { width: number; format: DerivativeFormat } | null {
  const format: DerivativeFormat = acceptsAvif && available.some((d) => d.format === 'avif') ? 'avif' : 'webp';
  const widths = available.filter((d) => d.format === format).map((d) => d.width).sort((a, b) => a - b);
  if (!widths.length) return null;
  return { width: widths.find((w) => w >= wanted) ?? widths[widths.length - 1]!, format };
}

// ---- storage keys and URLs ---------------------------------------------------

/** `<aa>/<32 hex>`: the random, content-independent name of one stored file family. */
export const BASE_RE = /^[0-9a-f]{2}\/[0-9a-f]{32}$/;

export const masterKey = (base: string) => `public/m/${base}.webp`;
export const derivativeKey = (base: string, width: number, format: DerivativeFormat) => `public/d/${base}/${width}.${format}`;
/** One JPEG at the largest derived width, for consumers that cannot take WebP/AVIF (WhatsApp headers, some feeds, email). */
export const shareKey = (base: string) => `public/d/${base}/share.jpg`;
export const privateKey = (base: string, ext: string) => `private/${base}.${ext}`;

/** `ab/<hex>` from any storage key of the family. */
export function baseOf(storageKey: string): string {
  const m = /^(?:public\/[md]|private)\/([0-9a-f]{2}\/[0-9a-f]{32})/.exec(storageKey);
  if (!m) throw new Error(`not a media storage key: ${storageKey}`);
  return m[1]!;
}

/** Public URL path of a stored public file (master or derivative). Private keys have no public URL. */
export function mediaSrc(storageKey: string): string {
  if (!storageKey.startsWith('public/')) throw new Error('private media has no public URL; use signedUrl()');
  return `/media/${storageKey.slice('public/'.length)}`;
}

/** JPEG share URL for a public image (exists once derivatives are generated). */
export const shareSrc = (storageKey: string) => mediaSrc(shareKey(baseOf(storageKey)));

export type MediaPath =
  | { type: 'file'; key: string }
  | { type: 'negotiate'; base: string; width: number }
  | { type: 'signed'; assetId: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Parses the segments after /media/. Whitelist only, so `..`, encoded slashes and anything unexpected is
 * simply not a match (404): masters `m/<aa>/<hex>.webp`, derivatives `d/<aa>/<hex>/<w>.<fmt>|share.jpg`,
 * width-negotiated `w/<w>/<aa>/<hex>` and signed private files `s/<uuid>`.
 */
export function parseMediaPath(segments: readonly string[]): MediaPath | null {
  const p = segments.join('/');
  let m = /^m\/([0-9a-f]{2}\/[0-9a-f]{32})\.webp$/.exec(p);
  if (m) return { type: 'file', key: `public/${p}` };
  m = /^d\/[0-9a-f]{2}\/[0-9a-f]{32}\/(?:[1-9]\d{0,3}\.(?:avif|webp)|share\.jpg)$/.exec(p);
  if (m) return { type: 'file', key: `public/${p}` };
  m = /^w\/([1-9]\d{0,3})\/([0-9a-f]{2}\/[0-9a-f]{32})$/.exec(p);
  if (m) return { type: 'negotiate', width: Number(m[1]), base: m[2]! };
  m = /^s\/([0-9a-f-]{36})$/.exec(p);
  if (m && UUID_RE.test(m[1]!)) return { type: 'signed', assetId: m[1]! };
  return null;
}

export const CONTENT_TYPES: Readonly<Record<string, string>> = {
  webp: 'image/webp',
  avif: 'image/avif',
  jpg: 'image/jpeg',
};

/**
 * next/image loader (`images.loaderFile`): media masters map to the width-negotiated derivative URL,
 * anything else (static files under public/) passes through with the width as a query.
 */
export function mediaLoader({ src, width }: { src: string; width: number; quality?: number }): string {
  const m = /^\/media\/m\/([0-9a-f]{2}\/[0-9a-f]{32})\.webp$/.exec(src);
  if (m) return `/media/w/${width}/${m[1]}`;
  return `${src}${src.includes('?') ? '&' : '?'}w=${width}`;
}

// ---- metadata ---------------------------------------------------------------

export const MEDIA_SOURCES = ['upload', 'woo_import', 'site_import', 'stock', 'wikimedia', 'client'] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

/** Editable library fields (admin form, upload form, seed manifest). Checkbox values arrive as 'on'. */
export const assetMetaSchema = z.object({
  alt: z.string().trim().max(250).optional(),
  caption: optionalText(500),
  source: z.enum(MEDIA_SOURCES).optional(),
  licence: optionalText(120),
  author: optionalText(200),
  sourceUrl: z
    .string()
    .trim()
    .max(1000)
    .transform((v) => (v === '' ? null : v))
    .pipe(z.url({ protocol: /^https?$/ }).nullable())
    .nullable()
    .optional(),
  creditRequired: z
    .union([z.boolean(), z.literal('on'), z.literal('true'), z.literal('false'), z.literal('')])
    .transform((v) => v === true || v === 'on' || v === 'true')
    .optional(),
});
export type AssetMeta = z.infer<typeof assetMetaSchema>;

/** Attribution line for licences that require it (CC BY, CC BY-SA): "author, licence". */
export function creditLine(asset: { creditRequired: boolean; author: string | null; licence: string | null }): string | null {
  if (!asset.creditRequired) return null;
  const line = [asset.author, asset.licence].filter(Boolean).join(', ');
  return line || null;
}
