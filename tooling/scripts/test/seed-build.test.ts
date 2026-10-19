// The seed build as a real CLI (`tsx seed/run.ts build`) writing into a temp tree: deterministic re-runs,
// a read-only --dry-run, the self-checks, and the committed outputs being current.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { selfCheck } from '../seed/self-check';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TSX = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));
const RUN = fileURLToPath(new URL('../seed/run.ts', import.meta.url));

function build(out: string, ...args: string[]) {
  const r = spawnSync(TSX, [RUN, 'build', ...args], { cwd: ROOT, env: { ...process.env, SEED_OUT_ROOT: out }, encoding: 'utf8', timeout: 120_000 });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

/** sha256 of every file under dir, keyed by relative path. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(dir, p)] = createHash('sha256').update(readFileSync(p)).digest('hex');
    }
  };
  walk(dir);
  return out;
}

let out: string;
let first: ReturnType<typeof build>;

beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), 'seed-build-'));
  first = build(out);
}, 180_000);
afterAll(() => rmSync(out, { recursive: true, force: true }));

describe('seed:build', () => {
  it('runs every step and passes its own self-check', () => {
    expect(first.code, first.out).toBe(0);
    expect(first.out).toContain('self-check: all checks passed');
    for (const f of ['products.json', 'inputs.json', 'models.json', 'faqs.json', 'cms.json', 'redirects.json', 'match-review.csv']) {
      expect(existsSync(join(out, 'data', 'seed', f)), f).toBe(true);
    }
    expect(existsSync(join(out, 'data', 'media', 'media-manifest.json'))).toBe(true);
    expect(existsSync(join(out, 'docs', 'CLIENT-QUESTIONS.md'))).toBe(true);
  });

  it('is deterministic: a second run leaves every file byte-identical', () => {
    const before = snapshot(out);
    const again = build(out);
    expect(again.code, again.out).toBe(0);
    expect(snapshot(out)).toEqual(before);
  }, 120_000);

  it('self-check on the written files finds nothing', () => {
    expect(selfCheck(join(out, 'data', 'seed'), join(out, 'data', 'media'))).toEqual([]);
  });

  it('--dry-run writes nothing: an empty tree stays empty and a stale file keeps its bytes', () => {
    const empty = mkdtempSync(join(tmpdir(), 'seed-dry-'));
    try {
      const r = build(empty, '--dry-run');
      expect(r.code, r.out).toBe(0);
      expect(snapshot(empty)).toEqual({});
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
    const file = join(out, 'data', 'seed', 'products.json');
    const good = readFileSync(file);
    const stale = Buffer.from(good.toString('utf8').replace('"Alphonso Mango"', '"Stale Mango"'));
    writeFileSync(file, stale);
    const master = join(out, 'data', 'media', 'masters', 'products');
    const extra = join(master, 'stale-extra.jpg');
    writeFileSync(extra, 'not an image');
    const before = snapshot(out);
    const r = build(out, '--dry-run');
    expect(r.code, r.out).toBe(0);
    expect(snapshot(out)).toEqual(before);
    // a real build repairs both
    expect(build(out).code).toBe(0);
    expect(readFileSync(file).toString('utf8')).toContain('"Alphonso Mango"');
    expect(existsSync(extra)).toBe(false);
  }, 180_000);

  it('the committed data/seed, media manifest and CLIENT-QUESTIONS.md are what the build produces', () => {
    const records = (p: string) => JSON.stringify(JSON.parse(readFileSync(p, 'utf8')).records);
    for (const f of ['products.json', 'inputs.json', 'models.json', 'faqs.json', 'cms.json', 'redirects.json']) {
      expect(records(join(ROOT, 'data', 'seed', f)), f).toBe(records(join(out, 'data', 'seed', f)));
    }
    expect(readFileSync(join(ROOT, 'data', 'seed', 'match-review.csv'), 'utf8')).toBe(readFileSync(join(out, 'data', 'seed', 'match-review.csv'), 'utf8'));
    const mine = (p: string) => JSON.parse(readFileSync(p, 'utf8')).records.filter((r: { file: string }) => /^(products|site)\//.test(r.file));
    expect(mine(join(ROOT, 'data', 'media', 'media-manifest.json'))).toEqual(mine(join(out, 'data', 'media', 'media-manifest.json')));
    expect(readFileSync(join(ROOT, 'docs', 'CLIENT-QUESTIONS.md'), 'utf8')).toBe(readFileSync(join(out, 'docs', 'CLIENT-QUESTIONS.md'), 'utf8'));
  });
});
