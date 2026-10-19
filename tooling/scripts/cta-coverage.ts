// pnpm cta-coverage [--strict]
// Source scan for data-cta ids vs the ids the Playwright click fixture recorded in apps/shop/e2e/.cta-hits.json.
// Skeleton: the e2e fixture that writes .cta-hits.json is built in the test wave.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CTA_RE = /data-cta=(?:"([^"]+)"|\{\s*['"`]([^'"`]+)['"`]\s*\})/g;

export function scanCtaIds(source: string): string[] {
  return [...source.matchAll(CTA_RE)].map((m) => (m[1] ?? m[2])!);
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === 'test' || name === 'e2e') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

export function sourceCtaIds(): Set<string> {
  const files = [...walk(join(ROOT, 'apps', 'shop', 'app')), ...readdirSync(join(ROOT, 'packages')).flatMap((p) => walk(join(ROOT, 'packages', p, 'src')))];
  return new Set(files.flatMap((f) => scanCtaIds(readFileSync(f, 'utf8'))));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ids = sourceCtaIds();
  const hitsFile = join(ROOT, 'apps', 'shop', 'e2e', '.cta-hits.json');
  const hits = new Set<string>(existsSync(hitsFile) ? (JSON.parse(readFileSync(hitsFile, 'utf8')) as string[]) : []);
  const missing = [...ids].filter((id) => !hits.has(id)).sort();
  const pct = ids.size ? Math.round(((ids.size - missing.length) / ids.size) * 100) : 100;
  console.log(`cta-coverage: ${ids.size} ids in source, ${ids.size - missing.length} clicked (${pct}%)`);
  for (const id of missing) console.log(`  not clicked: ${id}`);
  if (process.argv.includes('--strict') && missing.length) process.exit(1);
}
