// Storage ports other modules bind at boot (enquiry attachments, review photos, seed master lookups).
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ImageRef } from '@ecomkit/core/contracts';
import { assetIdsBySha256, getAsset, getImage, getImages, uploadFile, uploadImage } from './assets';
import { readKey } from './storage';

interface StoredFile {
  name: string;
  type: string;
  bytes: Uint8Array;
}

/** Private files (outside the web root, no derivatives): enquiries' `PrivateFileStore`. */
export const privateStore = {
  async putPrivate(file: StoredFile, _meta: { owner: string }): Promise<{ mediaId: string }> {
    const { asset } = await uploadFile({ bytes: file.bytes, originalName: file.name, isPrivate: true });
    return { mediaId: asset.id };
  },
  async read(mediaId: string): Promise<StoredFile | null> {
    const asset = /^[0-9a-f-]{36}$/i.test(mediaId) ? await getAsset(mediaId) : null;
    if (!asset?.isPrivate) return null;
    return { name: asset.originalName, type: asset.mime, bytes: new Uint8Array(await readKey(asset.storageKey)) };
  },
};

/** Public images (sniffed and re-encoded): reviews' `images` port. */
export const imageStore = {
  async putImage(file: StoredFile, _meta: { owner: string }): Promise<{ mediaId: string }> {
    const { asset } = await uploadImage({ bytes: file.bytes, originalName: file.name });
    return { mediaId: asset.id };
  },
  ref: (mediaId: string): Promise<ImageRef | null> => getImage(mediaId),
};

/** ImageRefs as a record (catalog, cms, seo `images` ports). */
export async function imageRefs(ids: readonly string[]): Promise<Record<string, ImageRef>> {
  return Object.fromEntries(await getImages(ids));
}

/** Asset ids for master files (`masters/<src>` under `mediaDir`) already imported, matched by content hash (seed). */
export async function masterAssetIds(srcs: readonly string[], mediaDir: string): Promise<Record<string, string>> {
  const hashes = new Map<string, string>();
  for (const src of srcs) {
    const path = join(mediaDir, 'masters', src);
    if (src.split('/').includes('..') || !existsSync(path)) continue;
    hashes.set(src, createHash('sha256').update(await readFile(path)).digest('hex'));
  }
  const ids = await assetIdsBySha256([...new Set(hashes.values())]);
  return Object.fromEntries([...hashes].flatMap(([src, h]) => (ids.has(h) ? [[src, ids.get(h)!]] : [])));
}
