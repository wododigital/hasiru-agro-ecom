// Shared plumbing for the seed build steps: paths, text cleaning, deterministic JSON output.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// @boundaries-ignore tooling may reference core sources relatively (see tooling eslint override)
export { slugify, SLUG_RE } from '../../../../packages/core/src/ids';

/** Repo root of the tree running the build (main tree or a worktree). */
export const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

let inputRootMemo: string | undefined;
/**
 * Where the gitignored inputs live (`latest_products.xlsx`, `images/`). They exist only in the main
 * tree, so a worktree resolves the main tree through git. `SEED_INPUT_ROOT` overrides.
 */
export function inputRoot(): string {
  if (inputRootMemo) return inputRootMemo;
  if (process.env.SEED_INPUT_ROOT) return (inputRootMemo = process.env.SEED_INPUT_ROOT);
  if (existsSync(join(ROOT, 'latest_products.xlsx'))) return (inputRootMemo = ROOT);
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8' }).trim();
  return (inputRootMemo = dirname(common));
}

export const paths = {
  xlsx: () => join(inputRoot(), 'latest_products.xlsx'),
  images: () => join(inputRoot(), 'images'),
  wooProducts: () => join(ROOT, '_work', 'products.json'),
  wooCatalog: () => join(ROOT, '_work', 'catalog.json'),
  imageMap: () => join(ROOT, '_work', 'image-map.json'),
};

/** Source labels written into each seed file's `sources` (repo-relative, never absolute). */
export const SOURCES = {
  xlsx: 'latest_products.xlsx',
  woo: '_work/products.json',
  catalog: '_work/catalog.json',
  imageMap: '_work/image-map.json',
  images: 'images/',
  research: 'docs/research/product-data.md (appendix A, as tooling/scripts/seed/data/research-rows.json)',
  handoff: 'HANDOFF.md',
  srs: 'HASIRU AGRO SRS Doc1 (1).pdf',
  site: 'hasiruagro.com (current site copy)',
};

export const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;

/**
 * Copy rules for every seed string: no em or en dashes (a numeric range becomes "to", anything else
 * a comma), no CR or literal "\n" escapes from the Woo export, single spaces, trimmed.
 */
export function cleanText(input: string): string {
  return input
    .replace(/\r?\\n|\r\n|\r/g, '\n')
    .replace(/(\d)\s*[–—]\s*(\d)/g, '$1 to $2')
    .replace(/\s*[–—]\s*/g, ', ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** cleanText for one-line values; empty becomes null. */
export const cleanLine = (input: unknown): string | null => {
  if (input === null || input === undefined) return null;
  const s = cleanText(String(input)).replace(/\n+/g, ' ').replace(/^"+|"+$/g, '').trim();
  return s ? s : null;
};

export const sha256 = (buf: Buffer | string) => createHash('sha256').update(buf).digest('hex');

/** Current time as ISO 8601 with the IST offset. */
export function istNow(at = new Date()): string {
  const ist = new Date(at.getTime() + 330 * 60_000);
  return `${ist.toISOString().slice(0, 19)}+05:30`;
}

export const toJson = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * Writes `{ version, generated_at, sources, records }` only when `records` (or `sources`) changed, so
 * an identical rebuild leaves the file byte-identical. Returns true when the file was written.
 */
export function writeSeedFile(file: string, sources: string[], records: unknown, opts: { dryRun?: boolean } = {}): boolean {
  if (existsSync(file)) {
    const prev = readJson<{ sources?: unknown; records?: unknown }>(file);
    if (toJson(prev.records) === toJson(records) && toJson(prev.sources) === toJson(sources)) return false;
  }
  if (opts.dryRun) return true;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, toJson({ version: 1, generated_at: istNow(), sources, records }));
  return true;
}

/** Writes a plain file only when its content differs. */
export function writeIfChanged(file: string, content: string, opts: { dryRun?: boolean } = {}): boolean {
  if (existsSync(file) && readFileSync(file, 'utf8') === content) return false;
  if (opts.dryRun) return true;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return true;
}

/** Memoise a zero-argument builder for the life of the process (steps share work through these). */
export function once<T>(fn: () => T): () => T {
  let done = false;
  let value: T;
  return () => {
    if (!done) {
      value = fn();
      done = true;
    }
    return value;
  };
}

export const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Round half up to the nearest 5 at or above Rs 100, to the rupee below (bulk price rule, plan 9.3). */
export const roundBulk = (value: number) => (value >= 100 ? Math.round(value / 5) * 5 : Math.round(value));

const unique = <T>(xs: Iterable<T>) => [...new Set(xs)];
export { unique };
