// Files on disk under MEDIA_ROOT and the sharp pipeline. No database here.
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import sharp from 'sharp';
import { BLUR_PX, MASTER_MAX_PX, MAX_INPUT_PIXELS, planWidths, QUALITY, type DerivativeFormat } from '../domain';

/**
 * Root of stored media: `public/` (served at /media) and `private/` (signed URLs only), both outside the
 * web root. Set MEDIA_ROOT to one absolute path for the web process, the worker and the seed run.
 */
export function mediaRoot(): string {
  // The ignore hint keeps the bundler from tracing the whole project into the server output.
  return resolve(/*turbopackIgnore: true*/ process.env.MEDIA_ROOT || join(process.cwd(), 'storage', 'media'));
}

/** Absolute path for a storage key; refuses anything that would leave the root. */
export function absPath(key: string): string {
  const root = mediaRoot();
  const p = resolve(/*turbopackIgnore: true*/ root, key);
  if (!p.startsWith(root + sep)) throw new Error(`storage key escapes the media root: ${key}`);
  return p;
}

/** Random `<aa>/<32 hex>` file family name; unrelated to the upload's name or content. */
export function newBase(): string {
  const hex = randomBytes(16).toString('hex');
  return `${hex.slice(0, 2)}/${hex}`;
}

/** Write via temp file + rename so a reader never sees half a file. */
export async function writeKey(key: string, data: Buffer): Promise<void> {
  const p = absPath(key);
  await mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, p);
}

export const readKey = (key: string) => readFile(absPath(key));

export async function removeKey(key: string): Promise<void> {
  await rm(absPath(key), { force: true, recursive: true });
}

export class ImageDecodeError extends Error {
  constructor(cause: unknown) {
    super(`image could not be decoded: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'ImageDecodeError';
  }
}

/**
 * Upload normalisation: decode (pixel cap), apply EXIF orientation, fit inside MASTER_MAX_PX without
 * enlarging, re-encode as WebP. sharp writes no input metadata unless asked, so EXIF (GPS, camera) and
 * any payload riding in the original container are dropped. First frame only for animated inputs.
 */
export async function normaliseImage(input: Uint8Array): Promise<{ data: Buffer; width: number; height: number; blurDataUrl: string }> {
  try {
    const { data, info } = await sharp(input, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: MASTER_MAX_PX, height: MASTER_MAX_PX, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: QUALITY.master })
      .toBuffer({ resolveWithObject: true });
    const blur = await sharp(data).resize(BLUR_PX, BLUR_PX, { fit: 'inside' }).webp({ quality: QUALITY.blur }).toBuffer();
    return { data, width: info.width, height: info.height, blurDataUrl: `data:image/webp;base64,${blur.toString('base64')}` };
  } catch (err) {
    throw new ImageDecodeError(err);
  }
}

export interface RenderedDerivative {
  format: DerivativeFormat | 'jpeg';
  width: number;
  data: Buffer;
}

/** AVIF + WebP at every planned width (never wider than the master), plus one share JPEG at the largest. */
export async function renderDerivatives(master: Buffer, masterWidth: number): Promise<RenderedDerivative[]> {
  const out: RenderedDerivative[] = [];
  const widths = planWidths(masterWidth);
  for (const width of widths) {
    const resized = sharp(master).resize({ width, withoutEnlargement: true });
    out.push({ format: 'avif', width, data: await resized.clone().avif({ quality: QUALITY.avif }).toBuffer() });
    out.push({ format: 'webp', width, data: await resized.clone().webp({ quality: QUALITY.webp }).toBuffer() });
  }
  const largest = widths[widths.length - 1]!;
  out.push({
    format: 'jpeg',
    width: largest,
    data: await sharp(master).resize({ width: largest, withoutEnlargement: true }).flatten({ background: { r: 255, g: 255, b: 255 } }).jpeg({ quality: QUALITY.jpeg, mozjpeg: true }).toBuffer(),
  });
  return out;
}
