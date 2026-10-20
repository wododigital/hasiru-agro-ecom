// Real Postgres, real sharp, real files under a temp MEDIA_ROOT.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { coreAuditLog } from '@ecomkit/core/schema';
import { createTestDb, queuedJobs, type TestDb } from '@ecomkit/core/testing';
import { count, eq, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DERIVATIVE_WIDTHS, MASTER_MAX_PX, mediaSrc } from '../src/domain';
import { mediaAsset, mediaDerivative } from '../src/schema';
import {
  deleteAsset,
  deriveAsset,
  getAsset,
  getImage,
  getImages,
  imageProps,
  listAssets,
  listDerivatives,
  staleProcessing,
  MediaInUseError,
  releaseUsage,
  trackUsage,
  updateAsset,
  uploadFile,
  uploadImage,
  UploadError,
  WARM_JOB,
} from '../src/server/assets';
import { warmJob, storageHealth } from '../src/server/jobs';
import { importMasters } from '../src/server/seed';
import { absPath } from '../src/server/storage';

let t: TestDb;
let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'wp03-media-'));
  process.env.MEDIA_ROOT = root;
  process.env.INTERNAL_SECRET = 'm'.repeat(40);
  t = await createTestDb('wp-03-media', { schemas: ['core', 'media'] });
});

afterAll(async () => {
  await t?.close();
  await rm(root, { recursive: true, force: true });
});

const noise = (w: number, h: number) => {
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } });
};
let seq = 0;
/** Distinct bytes per call (dedupe would otherwise merge fixtures). */
const jpeg = (w: number, h: number) => noise(w, h).jpeg({ quality: 70 + (seq++ % 25) }).toBuffer();
const log = { info() {}, warn() {}, error() {} };
const jobCtx = { jobId: 'test', queue: WARM_JOB, attempt: 1, log };

async function filesUnder(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!existsSync(dir)) return out;
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const p = join(entry.parentPath, entry.name);
    out.set(relative(dir, p), createHash('sha256').update(await readFile(p)).digest('hex'));
  }
  return out;
}

describe('upload normalisation', () => {
  it('applies EXIF orientation, strips EXIF and writes a WebP master with a blur placeholder', async () => {
    const input = await noise(1200, 800)
      .jpeg()
      .withExif({ IFD0: { Make: 'TestCam', Copyright: 'secret-owner' } })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const meta = await sharp(input).metadata();
    expect(meta.orientation).toBe(6);
    expect(meta.exif).toBeDefined();

    const { asset } = await uploadImage({ bytes: input, originalName: 'IMG_0001.JPG', derive: 'none' });
    expect(asset).toMatchObject({ kind: 'image', mime: 'image/webp', width: 800, height: 1200, status: 'ready', isPrivate: false });
    expect(asset.storageKey).toMatch(/^public\/m\/[0-9a-f]{2}\/[0-9a-f]{32}\.webp$/);
    expect(asset.storageKey).not.toContain('IMG');

    const stored = await readFile(absPath(asset.storageKey));
    expect(stored.includes(Buffer.from('secret-owner'))).toBe(false);
    const out = await sharp(stored).metadata();
    expect(out.format).toBe('webp');
    expect(out.exif).toBeUndefined();
    expect(out.orientation).toBeUndefined();
    expect(asset.bytes).toBe(stored.byteLength);

    expect(asset.blurDataUrl).toMatch(/^data:image\/webp;base64,/);
    const blur = await sharp(Buffer.from(asset.blurDataUrl!.split(',')[1]!, 'base64')).metadata();
    expect(Math.max(blur.width!, blur.height!)).toBeLessThanOrEqual(16);
  });

  it('fits huge masters inside the cap and never enlarges small ones', async () => {
    const big = await uploadImage({ bytes: await jpeg(3000, 2000), originalName: 'big.jpg', derive: 'none' });
    expect(big.asset.width).toBe(MASTER_MAX_PX);
    expect(big.asset.height).toBe(Math.round((2000 / 3000) * MASTER_MAX_PX));
    const small = await uploadImage({ bytes: await noise(100, 60).png().toBuffer(), originalName: 'tiny.png', derive: 'none' });
    expect([small.asset.width, small.asset.height]).toEqual([100, 60]);
  });

  it('decides the type from bytes, not the name', async () => {
    const png = await noise(50, 50).png().toBuffer();
    const { asset } = await uploadFile({ bytes: png, originalName: 'looks-like.pdf', derive: 'none' });
    expect(asset.kind).toBe('image');
    await expect(uploadFile({ bytes: Buffer.from('just text'), originalName: 'photo.png' })).rejects.toMatchObject({ code: 'unsupported_type', status: 415 });
  });

  it('refuses SVG, HEIC, corrupt, empty and oversized files without writing anything', async () => {
    const before = await filesUnder(root);
    const [{ n: rowsBefore }] = (await t.db.select({ n: count() }).from(mediaAsset)) as [{ n: number }];
    const cases: [Uint8Array, string][] = [
      [Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 'svg_refused'],
      [Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(16)]), 'heic_unsupported'],
      [Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('not really a jpeg at all')]), 'corrupt'],
      [Buffer.alloc(0), 'empty'],
      [Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(12 * 1024 * 1024)]), 'too_large'],
    ];
    for (const [bytes, code] of cases) {
      const err = await uploadFile({ bytes, originalName: 'x' }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UploadError);
      expect((err as UploadError).code).toBe(code);
    }
    expect(await filesUnder(root)).toEqual(before);
    const [{ n: rowsAfter }] = (await t.db.select({ n: count() }).from(mediaAsset)) as [{ n: number }];
    expect(rowsAfter).toBe(rowsBefore);
  });

  it('a field that accepts images refuses a PDF', async () => {
    await expect(uploadImage({ bytes: Buffer.from('%PDF-1.4\n%%EOF'), originalName: 'a.pdf' })).rejects.toMatchObject({ code: 'not_allowed' });
  });
});

describe('dedupe by sha256', () => {
  it('returns the existing asset for identical bytes, also under a race', async () => {
    const bytes = await jpeg(400, 300);
    const first = await uploadImage({ bytes, originalName: 'a.jpg', derive: 'none' });
    const again = await uploadImage({ bytes, originalName: 'b.jpg', derive: 'none', usage: { entity: 'catalog_product', entityId: 'p-1' } });
    expect(again).toMatchObject({ deduped: true, asset: { id: first.asset.id } });

    const racy = await jpeg(400, 300);
    const mastersBefore = (await filesUnder(join(root, 'public', 'm'))).size;
    const results = await Promise.all([1, 2, 3, 4].map((i) => uploadImage({ bytes: racy, originalName: `r${i}.jpg`, derive: 'none' })));
    expect(new Set(results.map((r) => r.asset.id)).size).toBe(1);
    expect(results.filter((r) => !r.deduped)).toHaveLength(1);
    // the losers' files were removed: exactly one new master on disk
    expect((await filesUnder(join(root, 'public', 'm'))).size).toBe(mastersBefore + 1);
  });
});

describe('derivatives', () => {
  it('generates AVIF + WebP across the ladder up to the master width, plus a share JPEG, and marks ready', async () => {
    const { asset } = await uploadImage({ bytes: await jpeg(1000, 750), originalName: 'pdp.jpg', derive: 'inline' });
    expect(asset.status).toBe('ready');
    const rows = await listDerivatives(asset.id);
    const ladder = [160, 320, 480, 640, 800, 960];
    expect(rows.filter((r) => r.format === 'avif').map((r) => r.width)).toEqual(ladder);
    expect(rows.filter((r) => r.format === 'webp').map((r) => r.width)).toEqual(ladder);
    expect(rows.filter((r) => r.format === 'jpeg').map((r) => r.width)).toEqual([960]);
    for (const r of rows) {
      const file = await readFile(absPath(r.storageKey));
      const m = await sharp(file).metadata();
      expect(m.width).toBe(r.width);
      expect(m.width).toBeLessThanOrEqual(asset.width!);
      expect(m.format).toBe(r.format === 'avif' ? 'heif' : r.format);
      expect(file.byteLength).toBe(r.bytes);
    }
  });

  it('never upscales: a 100 px master gets 100 px derivatives only', async () => {
    const { asset } = await uploadImage({ bytes: await noise(100, 80).png().toBuffer(), originalName: 'icon.png', derive: 'inline' });
    const rows = await listDerivatives(asset.id);
    expect(new Set(rows.map((r) => r.width))).toEqual(new Set([100]));
    for (const r of rows) expect((await sharp(await readFile(absPath(r.storageKey))).metadata()).width).toBe(100);
  });

  it('a 3000 px upload gets the whole ladder and nothing wider than 1920', async () => {
    const { asset } = await uploadImage({ bytes: await jpeg(3000, 1000), originalName: 'banner.jpg', derive: 'inline' });
    const widths = (await listDerivatives(asset.id)).filter((r) => r.format === 'webp').map((r) => r.width);
    expect(widths).toEqual([...DERIVATIVE_WIDTHS]);
  });

  it('upload queues the warm job; the job and the sweep generate derivatives', async () => {
    const { asset } = await uploadImage({ bytes: await jpeg(500, 500), originalName: 'queued.jpg' });
    expect(asset.status).toBe('processing');
    const jobs = await queuedJobs(t.db, WARM_JOB);
    expect(jobs.some((j) => (j.data as { assetId?: string }).assetId === asset.id)).toBe(true);
    await warmJob({ assetId: asset.id }, jobCtx);
    expect((await getAsset(asset.id))!.status).toBe('ready');

    const lost = await uploadImage({ bytes: await jpeg(300, 300), originalName: 'lost.jpg', derive: 'none' });
    // a queued upload whose job was lost: still processing, 10 minutes old
    await t.db.update(mediaAsset).set({ status: 'processing', updatedAt: sql`now() - interval '10 minutes'` }).where(eq(mediaAsset.id, lost.asset.id));
    await warmJob({}, jobCtx);
    expect((await getAsset(lost.asset.id))!.status).toBe('ready');
    expect((await listDerivatives(lost.asset.id)).length).toBeGreaterThan(0);
  });

  it('two derives of one asset at once (seed rerun next to the worker) both succeed with one row set', async () => {
    const { asset } = await uploadImage({ bytes: await jpeg(400, 300), originalName: 'twice.jpg', derive: 'none' });
    await Promise.all([deriveAsset(asset.id), deriveAsset(asset.id), deriveAsset(asset.id)]);
    const rows = await listDerivatives(asset.id);
    expect(rows.map((r) => `${r.format}:${r.width}`).sort()).toEqual(['avif:160', 'avif:320', 'jpeg:320', 'webp:160', 'webp:320']);
    expect((await getAsset(asset.id))!.status).toBe('ready');
  });

  it('a broken master marks the asset failed', async () => {
    const { asset } = await uploadImage({ bytes: await jpeg(200, 200), originalName: 'gone.jpg', derive: 'none' });
    await writeFile(absPath(asset.storageKey), 'garbage');
    await expect(deriveAsset(asset.id)).rejects.toThrow();
    expect((await getAsset(asset.id))!.status).toBe('failed');
  });
});

describe('rendering lookups', () => {
  it('returns ImageRefs in one batch, with credit only when required, and never private files', async () => {
    const pub = await uploadImage({
      bytes: await jpeg(640, 480),
      originalName: 'wiki.jpg',
      meta: { alt: 'Teak sapling', source: 'wikimedia', licence: 'CC BY-SA 4.0', author: 'A. Person', creditRequired: true },
      derive: 'none',
    });
    const priv = await uploadImage({ bytes: await jpeg(300, 200), originalName: 'land.jpg', isPrivate: true });
    const pdf = await uploadFile({ bytes: Buffer.from('%PDF-1.4\n1 0 obj\n%%EOF'), originalName: 'quote.pdf' });

    const refs = await getImages([pub.asset.id, priv.asset.id, pdf.asset.id, pub.asset.id]);
    expect([...refs.keys()]).toEqual([pub.asset.id]);
    expect(refs.get(pub.asset.id)).toEqual({
      id: pub.asset.id,
      src: mediaSrc(pub.asset.storageKey),
      alt: 'Teak sapling',
      width: 640,
      height: 480,
      blurDataURL: pub.asset.blurDataUrl,
      credit: 'A. Person, CC BY-SA 4.0',
    });
    expect(await getImage(priv.asset.id)).toBeNull();
    expect(await imageProps(pub.asset.id, '50vw')).toMatchObject({ sizes: '50vw', image: { id: pub.asset.id } });
    expect(await imageProps(null, '50vw')).toEqual({ image: null, sizes: '50vw' });
  });

  it('private images and documents live outside the public tree with no derivatives', async () => {
    const priv = await uploadImage({ bytes: await jpeg(300, 200), originalName: 'land2.jpg', isPrivate: true });
    expect(priv.asset).toMatchObject({ isPrivate: true, status: 'ready', blurDataUrl: null });
    expect(priv.asset.storageKey).toMatch(/^private\//);
    const pdf = await uploadFile({ bytes: Buffer.from('%PDF-1.4\n2 0 obj\n%%EOF'), originalName: 'invoice.pdf', isPrivate: false });
    expect(pdf.asset).toMatchObject({ kind: 'document', isPrivate: true, mime: 'application/pdf' });
    expect(pdf.asset.storageKey).toMatch(/^private\/.+\.pdf$/);
    expect(await listDerivatives(pdf.asset.id)).toEqual([]);
  });
});

describe('library: usage, edit, delete, list', () => {
  it('refuses to delete a used asset, deletes it with its files once released', async () => {
    const { asset } = await uploadImage({ bytes: await jpeg(400, 400), originalName: 'used.jpg', derive: 'inline', usage: { entity: 'cms_block', entityId: 'b1' } });
    await trackUsage(asset.id, 'catalog_product', 'p9');
    await expect(deleteAsset(asset.id, null)).rejects.toBeInstanceOf(MediaInUseError);
    await releaseUsage(asset.id, 'cms_block', 'b1');
    await releaseUsage(asset.id, 'catalog_product', 'p9');
    const derivedDir = absPath(`public/d/${asset.storageKey.slice('public/m/'.length, -'.webp'.length)}`);
    expect(existsSync(derivedDir)).toBe(true);
    await deleteAsset(asset.id, null);
    expect(await getAsset(asset.id)).toBeNull();
    expect(existsSync(absPath(asset.storageKey))).toBe(false);
    expect(existsSync(derivedDir)).toBe(false);
    expect(await t.db.select().from(mediaDerivative).where(eq(mediaDerivative.assetId, asset.id))).toEqual([]);
  });

  it('edits licence and credit fields with an audit row', async () => {
    const { asset } = await uploadImage({ bytes: await jpeg(300, 300), originalName: 'edit.jpg', derive: 'none' });
    const actor = '0192f1e2-3456-7abc-8def-0123456789ab';
    const after = await updateAsset(asset.id, { licence: 'CC BY 4.0', author: 'B. Person', creditRequired: 'on', sourceUrl: 'https://example.org/x' }, actor);
    expect(after).toMatchObject({ licence: 'CC BY 4.0', author: 'B. Person', creditRequired: true, sourceUrl: 'https://example.org/x' });
    const [row] = await t.db.select().from(coreAuditLog).where(eq(coreAuditLog.entityId, asset.id));
    expect(row).toMatchObject({ action: 'media.update', actorId: actor, after: { licence: 'CC BY 4.0', author: 'B. Person' } });
    await expect(updateAsset(asset.id, { sourceUrl: 'javascript:alert(1)' }, actor)).rejects.toThrow();
  });

  it('lists with filters for missing credit and unknown licence', async () => {
    const { asset } = await uploadImage({ bytes: await jpeg(200, 200), originalName: 'needs-credit.jpg', meta: { creditRequired: true, licence: 'CC BY 4.0' }, derive: 'none' });
    const missing = await listAssets({ credit: 'missing', pageSize: 100 });
    expect(missing.rows.map((r) => r.asset.id)).toContain(asset.id);
    expect(missing.rows.every((r) => r.asset.creditRequired && (!r.asset.author || !r.asset.licence))).toBe(true);
    const byName = await listAssets({ q: 'needs-credit' });
    expect(byName.total).toBe(1);
    expect(byName.rows[0]!.usages).toBe(0);
    expect((await listAssets({ q: '100%_' })).total).toBe(0);
  });
});

describe('seed hook', () => {
  it('imports masters idempotently; a dry run writes nothing', async () => {
    const mediaDir = await mkdtemp(join(tmpdir(), 'wp03-seed-'));
    await mkdir(join(mediaDir, 'masters', 'products'), { recursive: true });
    const file = await noise(900, 600).webp({ quality: 81 }).toBuffer();
    await writeFile(join(mediaDir, 'masters', 'products', 'sample-fruit-tree-2.webp'), file);
    const record = {
      file: 'products/sample-fruit-tree-2.webp',
      sha256: createHash('sha256').update(file).digest('hex'),
      source: 'wikimedia',
      licence: 'CC BY 4.0',
      author: 'C. Person',
      source_url: 'https://commons.wikimedia.org/wiki/File:Sample.jpg',
      credit_required: true,
      plants: ['P-1'],
      role: 'main',
    };
    const manifest = (records: unknown[]) => writeFile(join(mediaDir, 'media-manifest.json'), JSON.stringify({ version: 1, records }));
    await manifest([record, { file: '../escape.webp', source: 'stock' }, { file: 'products/missing.webp', source: 'stock' }]);
    const ctx = { seedDir: mediaDir, mediaDir, dryRun: false, log };

    const snapshot = await filesUnder(root);
    const [{ n: before }] = (await t.db.select({ n: count() }).from(mediaAsset)) as [{ n: number }];
    const dry = await importMasters({ ...ctx, dryRun: true });
    expect(dry).toMatchObject({ inserted: 1, updated: 0 });
    expect(await filesUnder(root)).toEqual(snapshot);
    const [{ n: afterDry }] = (await t.db.select({ n: count() }).from(mediaAsset)) as [{ n: number }];
    expect(afterDry).toBe(before);

    const first = await importMasters(ctx);
    expect(first).toMatchObject({ inserted: 1, updated: 0, skipped: 2 });
    const asset = (await t.db.select().from(mediaAsset).where(eq(mediaAsset.sha256, record.sha256)))[0]!;
    expect(asset).toMatchObject({ status: 'ready', source: 'wikimedia', author: 'C. Person', creditRequired: true, alt: 'Sample fruit tree', originalName: record.file });
    // seed images are served as masters: no derivative ladder now, and nothing left for the worker sweep
    expect(await listDerivatives(asset.id)).toEqual([]);
    expect(await staleProcessing(0)).not.toContain(asset.id);

    const second = await importMasters(ctx);
    expect(second).toMatchObject({ inserted: 0, updated: 0 });
    const again = (await t.db.select().from(mediaAsset).where(eq(mediaAsset.id, asset.id)))[0]!;
    expect(again.updatedAt).toEqual(asset.updatedAt);

    await manifest([{ ...record, licence: 'CC BY-SA 4.0' }]);
    expect(await importMasters(ctx)).toMatchObject({ inserted: 0, updated: 1 });
    await rm(mediaDir, { recursive: true, force: true });
  });

  it('reports a missing manifest instead of failing', async () => {
    const r = await importMasters({ seedDir: root, mediaDir: join(root, 'nope'), dryRun: false, log });
    expect(r).toMatchObject({ inserted: 0, updated: 0, skipped: 0 });
  });
});

describe('health', () => {
  it('reports writable storage', async () => {
    expect(await storageHealth()).toMatchObject({ status: 'ok' });
    expect((await stat(root)).isDirectory()).toBe(true);
  });
});
