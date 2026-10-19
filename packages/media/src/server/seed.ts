// Seed hook: import committed image masters listed in data/media/media-manifest.json (data/seed/SCHEMA.md).
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import type { SeedContext, SeedResult } from '@ecomkit/core/contracts';
import { db } from '@ecomkit/core/db';
import { z } from 'zod';
import { MEDIA_SOURCES } from '../domain';
import { mediaAsset } from '../schema';
import { deriveAsset, findBySha256, uploadFile } from './assets';

const recordSchema = z.object({
  file: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 _.()-]*(\/[A-Za-z0-9][A-Za-z0-9 _.()-]*)*$/, 'relative path under masters/'),
  sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  source: z.enum(MEDIA_SOURCES).catch('upload'),
  licence: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  source_url: z.string().nullable().optional(),
  credit_required: z.boolean().optional(),
});
const manifestSchema = z.object({ records: z.array(z.unknown()) });

/** "products/alphonso-mango-2.webp" -> "Alphonso mango": a usable default until someone writes better alt text. */
export function altFromFile(file: string): string {
  const name = (file.split('/').pop() ?? file).replace(/\.[a-z0-9]+$/i, '').replace(/[-_ ]\d+$/, '').replace(/[-_]+/g, ' ').trim();
  return name ? name[0]!.toUpperCase() + name.slice(1).toLowerCase() : '';
}

/** Idempotent by sha256: a second run inserts and updates nothing. Derivatives are generated inline. */
export async function importMasters(ctx: SeedContext): Promise<SeedResult> {
  const manifestFile = join(ctx.mediaDir, 'media-manifest.json');
  if (!existsSync(manifestFile)) return { inserted: 0, updated: 0, skipped: 0, notes: ['media-manifest.json not found; nothing imported'] };
  const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestFile, 'utf8')));
  const result = { inserted: 0, updated: 0, skipped: 0, notes: [] as string[] };

  for (const raw of manifest.records) {
    const parsed = recordSchema.safeParse(raw);
    if (!parsed.success || parsed.data.file.split('/').includes('..')) {
      result.skipped++;
      result.notes.push(`invalid manifest record: ${JSON.stringify(raw).slice(0, 120)}`);
      continue;
    }
    const rec = parsed.data;
    const path = join(ctx.mediaDir, 'masters', rec.file);
    if (!existsSync(path)) {
      result.skipped++;
      result.notes.push(`missing file: masters/${rec.file}`);
      continue;
    }
    const bytes = await readFile(path);
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (rec.sha256 && rec.sha256 !== hash) result.notes.push(`sha256 differs from manifest: ${rec.file}`);
    const meta = {
      source: rec.source,
      licence: rec.licence ?? null,
      author: rec.author ?? null,
      sourceUrl: rec.source_url ?? null,
      creditRequired: rec.credit_required ?? false,
    };

    const existing = await findBySha256(hash);
    if (!existing) {
      if (!ctx.dryRun) await uploadFile({ bytes, originalName: rec.file, meta: { ...meta, alt: altFromFile(rec.file) }, accept: ['image'], derive: 'inline' });
      result.inserted++;
      continue;
    }
    const changed = (Object.keys(meta) as (keyof typeof meta)[]).some((k) => existing[k] !== meta[k]);
    if (changed && !ctx.dryRun) await db.update(mediaAsset).set({ ...meta, updatedAt: sql`now()` }).where(eq(mediaAsset.id, existing.id));
    if (existing.status !== 'ready' && !ctx.dryRun) await deriveAsset(existing.id);
    if (changed || existing.status !== 'ready') result.updated++;
    else result.skipped++;
  }
  return result;
}
