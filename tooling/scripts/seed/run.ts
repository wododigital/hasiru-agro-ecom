// pnpm seed:build | pnpm seed:load [--app shop] [--dry-run]   (env SEED_OUT_ROOT: write outputs under another root)
// build: runs the pipeline steps in tooling/scripts/seed/<step>.ts (default export: (ctx) => Promise<void>),
//        skipping steps not written yet. Inputs are read, never modified; outputs go to data/seed.
// load:  runs every enabled module's seedHooks in dependency order (registry of the app).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// @boundaries-ignore type-only: core is loaded at runtime through the app's dependency graph
import type { SeedContext } from '../../../packages/core/src/contracts/extensions';
// @boundaries-ignore type-only: core is loaded at runtime through the app's dependency graph
import type { Registry } from '../../../packages/core/src/manifest/registry';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Pipeline order (BUILD-PLAN section 9). Image sourcing is an agent task, not a script step. */
export const BUILD_STEPS = [
  'normalize-plants',
  'match-woo',
  'fill-gaps',
  'inputs',
  'models',
  'districts',
  'pincodes',
  'media',
  'faqs',
  'cms-content',
  'legacy-redirects',
  'client-questions',
  'self-check',
] as const;

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
};

const log: SeedContext['log'] = {
  info: (m, d) => console.log(m, d ?? ''),
  warn: (m, d) => console.warn(m, d ?? ''),
  error: (m, d) => console.error(m, d ?? ''),
};

// SEED_OUT_ROOT redirects every output (data/seed, data/media, docs) to another tree, e.g. a test's temp dir.
const OUT = process.env.SEED_OUT_ROOT ?? ROOT;
const ctx: SeedContext = {
  seedDir: join(OUT, 'data', 'seed'),
  mediaDir: join(OUT, 'data', 'media'),
  dryRun: process.argv.includes('--dry-run'),
  log,
};

async function build(): Promise<void> {
  for (const step of BUILD_STEPS) {
    const file = join(ROOT, 'tooling', 'scripts', 'seed', `${step}.ts`);
    if (!existsSync(file)) {
      log.warn(`seed:build ${step}: not implemented yet, skipped`);
      continue;
    }
    const started = Date.now();
    const run = (await import(pathToFileURL(file).href)).default as (c: SeedContext) => Promise<void>;
    await run(ctx);
    log.info(`seed:build ${step}: done in ${Date.now() - started} ms`);
  }
}

async function load(app: string): Promise<void> {
  const registryFile = join(ROOT, 'apps', app, 'src', 'generated', 'registry.ts');
  const { registry } = (await import(pathToFileURL(registryFile).href)) as { registry: Registry };
  const hooks = registry.list('seedHooks');
  if (!hooks.length) log.warn(`seed:load ${app}: no enabled module has seed hooks`);
  for (const hook of hooks) {
    const run = await hook.run();
    const r = await run(ctx);
    log.info(`seed:load ${hook.moduleId}.${hook.id}: +${r.inserted} ~${r.updated} =${r.skipped}`, r.notes ? { notes: r.notes } : undefined);
  }
}

const command = process.argv[2];
if (command === 'build') await build();
else if (command === 'load') await load(arg('app', 'shop'));
else {
  console.error('usage: tsx tooling/scripts/seed/run.ts build|load [--app shop] [--dry-run]');
  process.exit(1);
}
