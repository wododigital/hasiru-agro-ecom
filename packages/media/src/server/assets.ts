// Media library data: upload, dedupe, derivatives, lookups for rendering, usage tracking, signed URLs.
import { createHash } from 'node:crypto';
import { and, asc, count, desc, eq, ilike, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { audit } from '@ecomkit/core/audit';
import type { ImageRef } from '@ecomkit/core/contracts';
import { db, withTx, type DbOrTx } from '@ecomkit/core/db';
import { signInternal, timingSafeEqual } from '@ecomkit/core/http';
import { enqueue, ensureQueue, getBoss } from '@ecomkit/core/jobs';
import { createLogger } from '@ecomkit/core/observability';
import {
  assetMetaSchema,
  baseOf,
  creditLine,
  derivativeKey,
  masterKey,
  MAX_UPLOAD_BYTES,
  mediaSrc,
  privateKey,
  shareKey,
  SIGNED_URL_TTL_SEC,
  sniff,
  type AssetMeta,
} from '../domain';
import { mediaAsset, mediaDerivative, mediaUsage, type MediaAsset } from '../schema';
import { ImageDecodeError, newBase, normaliseImage, readKey, removeKey, renderDerivatives, writeKey } from './storage';

const log = createLogger('media');
export const WARM_JOB = 'media.warm';

export type UploadErrorCode = 'unsupported_type' | 'svg_refused' | 'heic_unsupported' | 'not_allowed' | 'too_large' | 'corrupt' | 'empty';

const STATUS: Record<UploadErrorCode, number> = {
  unsupported_type: 415,
  svg_refused: 415,
  heic_unsupported: 415,
  not_allowed: 415,
  too_large: 413,
  corrupt: 422,
  empty: 400,
};

export class UploadError extends Error {
  readonly status: number;
  constructor(readonly code: UploadErrorCode) {
    super(`upload refused: ${code}`);
    this.name = 'UploadError';
    this.status = STATUS[code];
  }
}

export class MediaInUseError extends Error {
  readonly status = 409;
  constructor(readonly usages: number) {
    super(`media is used by ${usages} record(s)`);
    this.name = 'MediaInUseError';
  }
}

export interface UploadInput {
  bytes: Uint8Array;
  originalName: string;
  meta?: AssetMeta | Record<string, unknown>;
  /** Images only; documents are always private. Private files get no derivatives and no public URL. */
  isPrivate?: boolean;
  /** Kinds this caller accepts (an enquiry photo field takes images only). */
  accept?: readonly ('image' | 'document')[];
  createdBy?: string | null;
  usage?: { entity: string; entityId: string };
  /** Public images: generate derivatives now (`inline`, seed), in the worker (`queue`, default) or not at all. */
  derive?: 'queue' | 'inline' | 'none';
}

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

export async function getAsset(id: string): Promise<MediaAsset | null> {
  const [row] = await db.select().from(mediaAsset).where(eq(mediaAsset.id, id));
  return row ?? null;
}

export async function findBySha256(hash: string): Promise<MediaAsset | null> {
  const [row] = await db.select().from(mediaAsset).where(eq(mediaAsset.sha256, hash));
  return row ?? null;
}

/** sha256 -> asset id, for importers that link files they hashed themselves (catalog seed). */
export async function assetIdsBySha256(hashes: readonly string[]): Promise<Map<string, string>> {
  if (!hashes.length) return new Map();
  const rows = await db.select({ id: mediaAsset.id, sha256: mediaAsset.sha256 }).from(mediaAsset).where(inArray(mediaAsset.sha256, [...hashes]));
  return new Map(rows.map((r) => [r.sha256, r.id]));
}

/**
 * The one way bytes enter the library. Type comes from the bytes (SVG, HEIC and unknown types refused),
 * images are re-encoded by sharp (EXIF stripped, orientation applied), files get random names, and the
 * same bytes uploaded twice return the existing asset.
 */
export async function uploadFile(input: UploadInput): Promise<{ asset: MediaAsset; deduped: boolean }> {
  const bytes = input.bytes;
  if (bytes.byteLength === 0) throw new UploadError('empty');
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new UploadError('too_large');
  const sniffed = sniff(bytes);
  if (sniffed.kind === 'refused') throw new UploadError(sniffed.reason === 'svg' ? 'svg_refused' : sniffed.reason === 'heic' ? 'heic_unsupported' : 'unsupported_type');
  if (!(input.accept ?? ['image', 'document']).includes(sniffed.kind)) throw new UploadError('not_allowed');
  const meta = assetMetaSchema.parse(input.meta ?? {});
  const hash = sha256(bytes);

  const existing = await findBySha256(hash);
  if (existing) {
    if (input.usage) await trackUsage(existing.id, input.usage.entity, input.usage.entityId);
    return { asset: existing, deduped: true };
  }

  const base = newBase();
  const isPrivate = sniffed.kind === 'document' || input.isPrivate === true;
  let file: { key: string; data: Buffer; mime: string; width: number | null; height: number | null; blur: string | null };
  if (sniffed.kind === 'image') {
    let n;
    try {
      n = await normaliseImage(bytes);
    } catch (err) {
      if (err instanceof ImageDecodeError) throw new UploadError('corrupt');
      throw err;
    }
    file = { key: isPrivate ? privateKey(base, 'webp') : masterKey(base), data: n.data, mime: 'image/webp', width: n.width, height: n.height, blur: isPrivate ? null : n.blurDataUrl };
  } else {
    file = { key: privateKey(base, sniffed.ext), data: Buffer.from(bytes), mime: sniffed.mime, width: null, height: null, blur: null };
  }
  await writeKey(file.key, file.data);

  const needsDerivatives = sniffed.kind === 'image' && !isPrivate;
  const inserted = await withTx(async (tx) => {
    const [row] = await tx
      .insert(mediaAsset)
      .values({
        kind: sniffed.kind,
        storageKey: file.key,
        originalName: input.originalName.slice(0, 255) || 'upload',
        mime: file.mime,
        width: file.width,
        height: file.height,
        bytes: file.data.byteLength,
        sha256: hash,
        blurDataUrl: file.blur,
        alt: meta.alt ?? '',
        caption: meta.caption ?? null,
        source: meta.source ?? 'upload',
        licence: meta.licence ?? null,
        author: meta.author ?? null,
        sourceUrl: meta.sourceUrl ?? null,
        creditRequired: meta.creditRequired ?? false,
        isPrivate,
        status: needsDerivatives ? 'processing' : 'ready',
        createdBy: input.createdBy ?? null,
      })
      .onConflictDoNothing({ target: mediaAsset.sha256 })
      .returning();
    if (row && input.usage) await trackUsage(row.id, input.usage.entity, input.usage.entityId, { tx });
    return row;
  });

  if (!inserted) {
    // Lost a race with an identical upload: drop our copy, return theirs.
    await removeKey(file.key);
    const winner = (await findBySha256(hash))!;
    if (input.usage) await trackUsage(winner.id, input.usage.entity, input.usage.entityId);
    return { asset: winner, deduped: true };
  }
  if (input.createdBy) {
    await audit({ actorId: input.createdBy, actorType: 'staff', action: 'media.upload', entity: 'media_asset', entityId: inserted.id, after: { originalName: inserted.originalName, kind: inserted.kind } });
  }
  if (needsDerivatives) {
    if (input.derive === 'inline') return { asset: (await deriveAsset(inserted.id)) ?? inserted, deduped: false };
    if (input.derive !== 'none') await queueWarm(inserted.id);
  }
  return { asset: inserted, deduped: false };
}

/** Images only, for callers that never take documents. */
export function uploadImage(input: Omit<UploadInput, 'accept'>) {
  return uploadFile({ ...input, accept: ['image'] });
}

let warmQueue: Promise<void> | null = null;

/** Hands derivative generation to the worker. A failure here only delays it: the scheduled sweep picks the asset up. */
export async function queueWarm(assetId: string): Promise<void> {
  try {
    warmQueue ??= getBoss().then((boss) => ensureQueue(boss, WARM_JOB));
    await warmQueue;
    await enqueue(WARM_JOB, { assetId }, { singletonKey: assetId });
  } catch (err) {
    warmQueue = null;
    log.warn('could not queue derivative generation; the sweep will retry', { assetId, error: String(err) });
  }
}

/**
 * Generates AVIF/WebP derivatives across the width ladder (never enlarged) plus the share JPEG, replaces
 * the asset's derivative rows and marks it ready. A no-op for private files and documents.
 */
export async function deriveAsset(id: string): Promise<MediaAsset | null> {
  const asset = await getAsset(id);
  if (!asset || asset.kind !== 'image' || asset.isPrivate || !asset.width) return asset;
  try {
    const base = baseOf(asset.storageKey);
    const rendered = await renderDerivatives(await readKey(asset.storageKey), asset.width);
    const rows: (typeof mediaDerivative.$inferInsert)[] = [];
    for (const d of rendered) {
      const key = d.format === 'jpeg' ? shareKey(base) : derivativeKey(base, d.width, d.format);
      await writeKey(key, d.data);
      rows.push({ assetId: id, format: d.format, width: d.width, storageKey: key, bytes: d.data.byteLength });
    }
    return await withTx(async (tx) => {
      await tx.delete(mediaDerivative).where(eq(mediaDerivative.assetId, id));
      await tx.insert(mediaDerivative).values(rows);
      const [row] = await tx.update(mediaAsset).set({ status: 'ready', updatedAt: sql`now()` }).where(eq(mediaAsset.id, id)).returning();
      return row ?? null;
    });
  } catch (err) {
    await db.update(mediaAsset).set({ status: 'failed', updatedAt: sql`now()` }).where(eq(mediaAsset.id, id));
    throw err;
  }
}

/** Assets the queue lost (enqueue failed, worker down): processing for more than `olderThanMin` minutes. */
export async function staleProcessing(olderThanMin = 5, limit = 50): Promise<string[]> {
  const rows = await db
    .select({ id: mediaAsset.id })
    .from(mediaAsset)
    .where(and(eq(mediaAsset.status, 'processing'), lt(mediaAsset.updatedAt, sql`now() - make_interval(mins => ${olderThanMin})`)))
    .orderBy(asc(mediaAsset.updatedAt))
    .limit(limit);
  return rows.map((r) => r.id);
}

export async function listDerivatives(assetId: string) {
  return db.select().from(mediaDerivative).where(eq(mediaDerivative.assetId, assetId)).orderBy(asc(mediaDerivative.format), asc(mediaDerivative.width));
}

// ---- rendering ---------------------------------------------------------------

export function toImageRef(asset: MediaAsset): ImageRef | null {
  if (asset.kind !== 'image' || asset.isPrivate || !asset.width || !asset.height) return null;
  return {
    id: asset.id,
    src: mediaSrc(asset.storageKey),
    alt: asset.alt,
    width: asset.width,
    height: asset.height,
    blurDataURL: asset.blurDataUrl,
    credit: creditLine(asset),
  };
}

/** Batched: one query for a whole grid. Private files and documents are never returned. */
export async function getImages(ids: readonly string[]): Promise<Map<string, ImageRef>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const rows = await db
    .select()
    .from(mediaAsset)
    .where(and(inArray(mediaAsset.id, unique), eq(mediaAsset.kind, 'image'), eq(mediaAsset.isPrivate, false)));
  const out = new Map<string, ImageRef>();
  for (const row of rows) {
    const ref = toImageRef(row);
    if (ref) out.set(row.id, ref);
  }
  return out;
}

export async function getImage(id: string): Promise<ImageRef | null> {
  return (await getImages([id])).get(id) ?? null;
}

/** Props for `ui/ImageWithFallback`: `<ImageWithFallback {...await imageProps(id, '(min-width: 768px) 33vw, 50vw')} />`. */
export async function imageProps(id: string | null | undefined, sizes: string): Promise<{ image: ImageRef | null; sizes: string }> {
  return { image: id ? await getImage(id) : null, sizes };
}

// ---- usage -------------------------------------------------------------------

export async function trackUsage(assetId: string, entity: string, entityId: string, options: { tx?: DbOrTx } = {}): Promise<void> {
  await (options.tx ?? db).insert(mediaUsage).values({ assetId, entity, entityId }).onConflictDoNothing();
}

export async function releaseUsage(assetId: string, entity: string, entityId: string, options: { tx?: DbOrTx } = {}): Promise<void> {
  await (options.tx ?? db)
    .delete(mediaUsage)
    .where(and(eq(mediaUsage.assetId, assetId), eq(mediaUsage.entity, entity), eq(mediaUsage.entityId, entityId)));
}

export async function listUsage(assetId: string) {
  return db.select().from(mediaUsage).where(eq(mediaUsage.assetId, assetId)).orderBy(asc(mediaUsage.entity), asc(mediaUsage.entityId));
}

// ---- library admin -----------------------------------------------------------

export interface ListAssetsInput {
  q?: string;
  kind?: 'image' | 'document';
  source?: MediaAsset['source'];
  /** `missing`: credit required but author or licence empty. `unknown`: no licence recorded. */
  credit?: 'missing' | 'unknown';
  sort?: 'created' | 'name' | 'bytes';
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export async function listAssets(input: ListAssetsInput = {}) {
  const pageSize = input.pageSize ?? 30;
  const page = Math.max(1, input.page ?? 1);
  const q = input.q?.trim();
  const like = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const where: SQL | undefined = and(
    like ? or(ilike(mediaAsset.originalName, like), ilike(mediaAsset.alt, like)) : undefined,
    input.kind ? eq(mediaAsset.kind, input.kind) : undefined,
    input.source ? eq(mediaAsset.source, input.source) : undefined,
    input.credit === 'missing' ? and(eq(mediaAsset.creditRequired, true), or(isNull(mediaAsset.author), isNull(mediaAsset.licence))) : undefined,
    input.credit === 'unknown' ? isNull(mediaAsset.licence) : undefined,
  );
  const column = input.sort === 'name' ? mediaAsset.originalName : input.sort === 'bytes' ? mediaAsset.bytes : mediaAsset.createdAt;
  const order = (input.dir ?? 'desc') === 'asc' ? asc : desc;
  const usages = db.$with('usages').as(db.select({ assetId: mediaUsage.assetId, n: count().as('n') }).from(mediaUsage).groupBy(mediaUsage.assetId));
  const [rows, [total]] = await Promise.all([
    db
      .with(usages)
      .select({ asset: mediaAsset, usages: sql<number>`coalesce(${usages.n}, 0)::int` })
      .from(mediaAsset)
      .leftJoin(usages, eq(usages.assetId, mediaAsset.id))
      .where(where)
      .orderBy(order(column), order(mediaAsset.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: count() }).from(mediaAsset).where(where),
  ]);
  return { rows, total: total?.n ?? 0, page, pageSize };
}

export async function updateAsset(id: string, patch: AssetMeta | Record<string, unknown>, actorId: string | null): Promise<MediaAsset> {
  const meta = assetMetaSchema.parse(patch);
  const before = await getAsset(id);
  if (!before) throw new Error('media asset not found');
  const set = Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined)) as Partial<MediaAsset>;
  if (!Object.keys(set).length) return before;
  const [after] = await db.update(mediaAsset).set({ ...set, updatedAt: sql`now()` }).where(eq(mediaAsset.id, id)).returning();
  const pick = (a: MediaAsset) => Object.fromEntries(Object.keys(set).map((k) => [k, a[k as keyof MediaAsset]]));
  await audit({ actorId, actorType: actorId ? 'staff' : 'system', action: 'media.update', entity: 'media_asset', entityId: id, before: pick(before), after: pick(after!) });
  return after!;
}

/** Deletes an unused asset and its files. Anything still referenced (product, page, review) is refused. */
export async function deleteAsset(id: string, actorId: string | null): Promise<void> {
  const asset = await getAsset(id);
  if (!asset) return;
  const [used] = await db.select({ n: count() }).from(mediaUsage).where(eq(mediaUsage.assetId, id));
  if (used && used.n > 0) throw new MediaInUseError(used.n);
  await db.delete(mediaAsset).where(eq(mediaAsset.id, id));
  await removeKey(asset.storageKey);
  if (asset.storageKey.startsWith('public/m/')) await removeKey(`public/d/${baseOf(asset.storageKey)}`);
  await audit({ actorId, actorType: actorId ? 'staff' : 'system', action: 'media.delete', entity: 'media_asset', entityId: id, before: { originalName: asset.originalName, sha256: asset.sha256 } });
}

// ---- signed URLs -------------------------------------------------------------

const PURPOSE = 'media-url';

/** Time-limited URL for a private file. Issue it only after the caller's own permission or ownership check. */
export function signedUrl(assetId: string, options: { ttlSec?: number; now?: number } = {}): string {
  const exp = Math.floor((options.now ?? Date.now()) / 1000) + (options.ttlSec ?? SIGNED_URL_TTL_SEC);
  return `/media/s/${assetId}?e=${exp}&t=${signInternal(`${assetId}.${exp}`, PURPOSE)}`;
}

export function verifySignedUrl(assetId: string, exp: string | null, token: string | null, now = Date.now()): boolean {
  if (!exp || !token || !/^\d{1,12}$/.test(exp)) return false;
  if (Number(exp) * 1000 < now) return false;
  return timingSafeEqual(token, signInternal(`${assetId}.${exp}`, PURPOSE));
}
