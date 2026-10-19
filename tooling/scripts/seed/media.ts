// Step 9.7: copy the image masters the seed uses from the backup into data/media/masters/{products,site}/
// and write data/media/media-manifest.json. Files are copied only when missing or changed; files in those
// two folders that nothing uses any more are removed. Records for sourced/ photos (WP-13) are kept as is.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { SeedContext } from '../../../packages/core/src/contracts/extensions';
import { readJson, sha256, SOURCES, writeSeedFile } from './lib/common';
import { allMasters, type MasterFile, primaryRole, siteImages } from './lib/media-plan';
import { buildProducts } from './fill-gaps';

export interface ManifestRecord {
  file: string;
  sha256: string;
  source: 'woo_import' | 'site_import' | 'stock' | 'wikimedia' | 'client';
  licence: string;
  author: string | null;
  source_url: string | null;
  credit_required: boolean;
  plants: string[];
  role: 'main' | 'gallery' | 'as_delivered' | 'site';
}

export const OWNED_DIRS = ['products', 'site'] as const;
const LICENCE = {
  woo_import: 'Unverified: used on the old hasiruagro.com shop; confirm rights or replace',
  site_import: 'Hasiru Agro: current hasiruagro.com site',
} as const;

const toRecord = (m: MasterFile): ManifestRecord => ({
  file: m.file,
  sha256: m.sha256,
  source: m.source,
  licence: LICENCE[m.source],
  author: null,
  source_url: m.source_url,
  credit_required: false,
  plants: [...m.plants].sort(),
  role: primaryRole(m),
});

/** Manifest records this step owns, built from the same registry the product records used. */
export function mediaRecords(): ManifestRecord[] {
  buildProducts(); // registers every product image
  siteImages(); // and every current-site image
  return allMasters().map(toRecord);
}

export default async function step(ctx: SeedContext): Promise<void> {
  const masters = join(ctx.mediaDir, 'masters');
  const records = mediaRecords();
  const plan = new Map(allMasters().map((m) => [m.file, m]));
  let copied = 0;
  let removed = 0;
  for (const m of plan.values()) {
    const dest = join(masters, m.file);
    if (existsSync(dest) && sha256(readFileSync(dest)) === m.sha256) continue;
    if (!ctx.dryRun) {
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(m.from, dest);
    }
    copied++;
  }
  for (const dir of OWNED_DIRS) {
    const abs = join(masters, dir);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs)) {
      if (plan.has(`${dir}/${f}`)) continue;
      if (!ctx.dryRun) rmSync(join(abs, f));
      removed++;
    }
  }
  const manifestFile = join(ctx.mediaDir, 'media-manifest.json');
  const others = existsSync(manifestFile)
    ? readJson<{ records: ManifestRecord[] }>(manifestFile).records.filter((r) => !OWNED_DIRS.some((d) => r.file.startsWith(`${d}/`)))
    : [];
  const all = [...records, ...others].sort((a, b) => a.sha256.localeCompare(b.sha256));
  writeSeedFile(manifestFile, [SOURCES.images, SOURCES.imageMap, SOURCES.woo], all, ctx);
  ctx.log.info(`media: ${records.length} masters (${copied} copied, ${removed} removed), ${others.length} records kept from other steps`);
}
