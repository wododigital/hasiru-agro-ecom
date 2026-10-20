// Which image masters the seed uses and where they land under data/media/masters/. Product records
// register their images here while they are built; the media step then copies the files and writes
// media-manifest.json from the same registry, so a record can never point at a file that is not copied.
import { readdirSync, readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { paths, readJson, sha256, slugify } from './common';
import { imageSize } from './image-size';

export type MediaSource = 'woo_import' | 'site_import';
export type MediaRole = 'main' | 'gallery' | 'as_delivered' | 'site';

export interface MasterFile {
  /** Path relative to data/media/masters/. */
  file: string;
  /** Absolute source path in the image backup. */
  from: string;
  sha256: string;
  w: number;
  h: number;
  source: MediaSource;
  source_url: string | null;
  plants: Set<string>;
  roles: Set<MediaRole>;
}

const OLD_SHOP = 'https://hasiruagro.com';
const ROLE_RANK: MediaRole[] = ['main', 'as_delivered', 'gallery', 'site'];

const bySha = new Map<string, MasterFile>();
const byFrom = new Map<string, MasterFile>();
const taken = new Set<string>();

function master(from: string, dir: 'products' | 'site', source: MediaSource, sourceUrl: string | null): MasterFile {
  const known = byFrom.get(from);
  if (known) return known;
  if (/saplingmart/i.test(from)) throw new Error(`third-party branded image refused: ${from}`);
  const buf = readFileSync(from);
  const hash = sha256(buf);
  const dupe = bySha.get(hash);
  if (dupe) {
    byFrom.set(from, dupe);
    return dupe;
  }
  const ext = extname(from).toLowerCase().replace('.jpeg', '.jpg');
  const stem = dir === 'site' ? basename(from, extname(from)) : slugify(basename(from, extname(from)));
  let file = `${dir}/${stem}${ext}`;
  for (let n = 2; taken.has(file); n++) file = `${dir}/${stem}-${n}${ext}`;
  taken.add(file);
  const { w, h } = imageSize(buf);
  const m: MasterFile = { file, from, sha256: hash, w, h, source, source_url: sourceUrl, plants: new Set(), roles: new Set() };
  bySha.set(hash, m);
  byFrom.set(from, m);
  return m;
}

/** Absolute backup path for an old-shop upload URL. */
export function wooUrlToPath(url: string): string {
  const rel = url.split('/wp-content/uploads/')[1];
  if (!rel) throw new Error(`not an uploads URL: ${url}`);
  return join(paths.images(), 'wordpress uploads', decodeURIComponent(rel));
}

/** Register an old-shop image (by backup path, repo-relative to the input root or absolute). */
export function registerProductImage(fromPath: string, sku: string, role: MediaRole): MasterFile {
  const from = fromPath.startsWith('/') ? fromPath : join(paths.images(), '..', fromPath);
  const rel = from.split('/wordpress uploads/')[1];
  const m = master(from, 'products', 'woo_import', rel ? `${OLD_SHOP}/wp-content/uploads/${encodeURI(rel)}` : null);
  m.plants.add(sku);
  m.roles.add(role);
  return m;
}

/** Every current-site image (images/*.webp|png|jpg), registered once. */
export function siteImages(): MasterFile[] {
  const dir = paths.images();
  return readdirSync(dir)
    .filter((f) => /\.(webp|png|jpe?g)$/i.test(f))
    .sort()
    .map((f) => {
      const m = master(join(dir, f), 'site', 'site_import', `${OLD_SHOP}/images/${f}`);
      m.roles.add('site');
      return m;
    });
}

/** A current-site photo used on a product page (real Hasiru field photos, research section 5). */
export function registerSiteImage(name: string, sku: string): MasterFile {
  const m = master(join(paths.images(), name), 'site', 'site_import', `${OLD_SHOP}/images/${name}`);
  m.plants.add(sku);
  m.roles.add('site');
  return m;
}

/** The master a current-site image landed in (its own file, or an identical product photo). */
export function siteMaster(name: string): MasterFile | undefined {
  siteImages();
  return byFrom.get(join(paths.images(), name));
}

/** A Wikimedia Commons photo sourced for a plant the backup has no photo of (WP-13, data/media/sourcing-log.json). */
export interface SourcedPhoto {
  file: string;
  /** Absolute path of the committed file (copied when the build writes to another root). */
  from: string;
  sha256: string;
  w: number;
  h: number;
  licence: string;
  author: string | null;
  source_url: string;
  credit_required: boolean;
  credit: string;
  plants: Set<string>;
}
interface SourcingEntry {
  status: 'sourced' | 'missing' | 'shared';
  file?: string;
  same_as?: string;
  licence?: string;
  author?: string | null;
  source_url?: string;
  credit_required?: boolean;
  credit?: string;
}
const sourced = new Map<string, SourcedPhoto>();
let sourcingLog: Record<string, SourcingEntry> | undefined;

/** The sourced photo for an image-map plant key (following `shared` entries), registered for `sku`. */
export function registerSourcedImage(plantKey: string, sku: string): SourcedPhoto | undefined {
  sourcingLog ??= readJson<{ plants: Record<string, SourcingEntry> }>(paths.sourcingLog()).plants;
  let e = sourcingLog[plantKey];
  if (e?.status === 'shared' && e.same_as) e = sourcingLog[e.same_as];
  if (e?.status !== 'sourced' || !e.file || !e.licence || !e.source_url) return undefined;
  let photo = sourced.get(e.file);
  if (!photo) {
    const from = join(paths.masters(), e.file);
    const buf = readFileSync(from);
    const { w, h } = imageSize(buf);
    photo = {
      file: e.file, from, sha256: sha256(buf), w, h, licence: e.licence, author: e.author ?? null, source_url: e.source_url,
      credit_required: e.credit_required ?? true, credit: e.credit ?? `${e.author ?? 'Unknown'}, ${e.licence}, via Wikimedia Commons`, plants: new Set(),
    };
    sourced.set(e.file, photo);
  }
  photo.plants.add(sku);
  return photo;
}

export const allSourced = () => [...sourced.values()].sort((a, b) => a.file.localeCompare(b.file));
export const allMasters = () => [...bySha.values()].sort((a, b) => a.file.localeCompare(b.file));
export const primaryRole = (m: MasterFile): MediaRole => ROLE_RANK.find((r) => m.roles.has(r)) ?? 'gallery';
