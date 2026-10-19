// Last build step: checks the files on disk (not the in-memory build), so a hand edit or a partial run is
// caught too. Fails the build with every problem listed.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SeedContext } from '../../../packages/core/src/contracts/extensions';
import { readJson, sha256, SLUG_RE } from './lib/common';
import type { ProductRecord } from './fill-gaps';
import type { ManifestRecord } from './media';
import type { ModelRecord } from './models';
import type { FaqRecord } from './faqs';
import type { RedirectRecord } from './legacy-redirects';

/** Expected shape of the catalogue (plan 9.2 and research section 4). */
export const EXPECTED = {
  clientRows: 159,
  extra: 1,
  inputs: 7,
  /** 193 Woo plants - 65 exact matches - Agarwood - 2 rows that became size variants. */
  legacy: 125,
  match: { exact: 65, sibling: 15, none: 24, native: 55 },
};

const FORBIDDEN_TEXT: [RegExp, string][] = [
  [/[–—]/, 'em or en dash'],
  [/\bphase\b|\bv1\b|\bv2\b/i, '"phase", "v1" or "v2"'],
  [/sapling ?mart/i, 'third-party brand name'],
];

function walkStrings(value: unknown, path: string, visit: (s: string, path: string) => void): void {
  if (typeof value === 'string') visit(value, path);
  else if (Array.isArray(value)) value.forEach((v, i) => walkStrings(v, `${path}[${i}]`, visit));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walkStrings(v, `${path}.${k}`, visit);
}

export function selfCheck(seedDir: string, mediaDir: string): string[] {
  const errors: string[] = [];
  const fail = (m: string) => errors.push(m);
  const load = <T>(name: string): T => readJson<{ records: T }>(join(seedDir, name)).records;
  const products = load<ProductRecord[]>('products.json');
  const inputs = load<ProductRecord[]>('inputs.json');
  const models = load<ModelRecord[]>('models.json');
  const faqs = load<FaqRecord[]>('faqs.json');
  const redirects = load<RedirectRecord[]>('redirects.json');
  const cms = load<Record<string, unknown>>('cms.json');
  const manifest = readJson<{ records: ManifestRecord[] }>(join(mediaDir, 'media-manifest.json')).records;

  // row counts
  const client = products.filter((p) => p.data_source === 'client');
  const count = (n: number, want: number, what: string) => n !== want && fail(`${what}: ${n}, expected ${want}`);
  count(client.length, EXPECTED.clientRows, 'client plant rows');
  count(products.filter((p) => p.data_source === 'woo_extra').length, EXPECTED.extra, 'Agarwood (extra) rows');
  count(products.filter((p) => p.data_source === 'woo_legacy').length, EXPECTED.legacy, 'woo_legacy draft rows');
  count(inputs.length, EXPECTED.inputs, 'input products');
  const native = client.filter((p) => p.source_row! >= 100 && p.source_row! <= 154);
  count(client.filter((p) => p.match?.kind === 'exact').length, EXPECTED.match.exact, 'exact matches');
  count(client.filter((p) => p.match?.kind === 'sibling').length, EXPECTED.match.sibling, 'sibling matches');
  count(client.filter((p) => p.match?.kind === 'none').length - native.length, EXPECTED.match.none, 'unmatched common rows');
  count(native.filter((p) => p.match?.kind === 'none').length, EXPECTED.match.native, 'native rows never matched');

  // identity
  const all = [...products, ...inputs];
  const seen = new Set<string>();
  for (const p of all) {
    if (seen.has(p.sku)) fail(`duplicate sku ${p.sku}`);
    seen.add(p.sku);
    if (!SLUG_RE.test(p.slug)) fail(`${p.sku}: invalid slug "${p.slug}"`);
    if (p.source_row && p.sku !== `HAP-${String(p.source_row - 3).padStart(4, '0')}`) fail(`${p.sku}: sku does not follow source_row ${p.source_row}`);
    if (!p.variants.length) fail(`${p.sku}: no variants`);
    p.variants.forEach((v, i) => {
      if (v.sku !== `${p.sku}-${String(i + 1).padStart(2, '0')}`) fail(`${p.sku}: variant sku ${v.sku}`);
      if (p.status === 'active' && !(Number.isInteger(v.price) && v.price > 0)) fail(`${v.sku}: active without a price`);
      if (!(Number.isInteger(v.bulk_price) && v.bulk_price > 0 && v.bulk_price <= v.price)) fail(`${v.sku}: bad bulk price ${v.bulk_price}`);
      if (v.compare_at_price !== null && (v.compare_at_price <= v.price || p.match?.kind !== 'exact')) fail(`${v.sku}: compare-at ${v.compare_at_price} not a real old price`);
      if ((v.stock_qty > 0) !== (v.availability === 'in_stock')) fail(`${v.sku}: availability does not follow stock`);
    });
    if (p.status === 'draft' && !p.seo.noindex) fail(`${p.sku}: draft without noindex`);
  }
  const slugs = all.map((p) => p.slug);
  const dupSlugs = slugs.filter((s, i) => slugs.indexOf(s) !== i);
  if (dupSlugs.length) fail(`duplicate slugs: ${[...new Set(dupSlugs)].join(', ')}`);

  // images: every referenced file exists, is in the manifest, and matches its hash
  const bySrc = new Map(manifest.map((m) => [m.file, m]));
  for (const p of all) {
    for (const im of p.media.images) {
      if (!bySrc.has(im.src)) fail(`${p.sku}: image ${im.src} not in media-manifest.json`);
    }
    if (p.media.image_needed !== (p.media.images.length === 0)) fail(`${p.sku}: image_needed out of step with images`);
  }
  for (const m of manifest) {
    const file = join(mediaDir, 'masters', m.file);
    if (!existsSync(file)) fail(`media master missing: ${m.file}`);
    else if (sha256(readFileSync(file)) !== m.sha256) fail(`media master changed on disk: ${m.file}`);
  }
  walkStrings(cms, 'cms', (s, path) => {
    if (/^(site|products|sourced)\/[^ ]+\.(webp|png|jpe?g)$/.test(s) && !bySrc.has(s)) fail(`${path}: image ${s} not in media-manifest.json`);
  });

  // references
  const skus = new Set(all.map((p) => p.sku));
  const activeSkus = new Set(all.filter((p) => p.status === 'active').map((p) => p.sku));
  for (const m of models) for (const x of m.members) if (!activeSkus.has(x.sku)) fail(`model ${m.slug}: member ${x.sku} is not an active product`);
  for (const f of faqs) {
    if (f.product_sku && !skus.has(f.product_sku)) fail(`faq ${f.key}: unknown sku ${f.product_sku}`);
    if (f.status === 'approved' && !f.answer) fail(`faq ${f.key}: approved without an answer`);
  }
  for (const r of redirects) if (r.to_sku && !skus.has(r.to_sku)) fail(`redirect ${r.from}: unknown sku ${r.to_sku}`);

  // copy rules over every string in every seed file
  const files: [string, unknown][] = [['products', products], ['inputs', inputs], ['models', models], ['faqs', faqs], ['cms', cms], ['redirects', redirects]];
  for (const [name, data] of files) {
    walkStrings(data, name, (s, path) => {
      for (const [re, what] of FORBIDDEN_TEXT) if (re.test(s)) fail(`${path}: contains ${what}: "${s.slice(0, 80)}"`);
      if (/\r|\\n/.test(s)) fail(`${path}: contains a CR or a literal \\n`);
    });
  }
  return errors;
}

export default async function step(ctx: SeedContext): Promise<void> {
  if (ctx.dryRun) return ctx.log.info('self-check: skipped on --dry-run (nothing written)');
  const errors = selfCheck(ctx.seedDir, ctx.mediaDir);
  if (errors.length) {
    for (const e of errors) ctx.log.error(`self-check: ${e}`);
    throw new Error(`seed self-check failed with ${errors.length} problem(s)`);
  }
  ctx.log.info('self-check: all checks passed');
}
