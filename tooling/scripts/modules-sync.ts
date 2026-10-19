// pnpm modules:sync [--app shop] [--config dev|test|prod] [--check] [--list]
// Reads apps/<app>/modules.config.<config>.ts, loads each enabled module's manifest from the app's
// dependency graph, validates, and writes route stubs + src/generated/{registry,schema}.ts.
// Never overwrites a file without the generated header; removes stale generated files.
// --check exits 1 when the tree differs from the plan (CI drift guard). --list prints the plan and never writes.
import { existsSync, readdirSync, readFileSync, rmdirSync, statSync, unlinkSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// @boundaries-ignore type-only: core is loaded at runtime through the app's dependency graph
import type { AppConfig, ModuleManifest } from '../../packages/core/src/contracts/manifest';
// @boundaries-ignore type-only: core is loaded at runtime through the app's dependency graph
import type * as ManifestModule from '../../packages/core/src/manifest/index';

type ManifestApi = typeof ManifestModule;

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

export interface SyncResult {
  written: string[];
  removed: string[];
  keptHandWritten: string[];
  planned: string[];
}

/** Every file under `dir` (app-relative, posix) whose first line is the generated header. */
function generatedFiles(appDir: string, header: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name) && readFileSync(full, 'utf8').startsWith(header)) out.push(relative(appDir, full).split(sep).join('/'));
    }
  };
  walk(join(appDir, 'app'));
  walk(join(appDir, 'src', 'generated'));
  return out;
}

function pruneEmptyDirs(dir: string, stopAt: string): void {
  while (dir.startsWith(stopAt) && dir !== stopAt && existsSync(dir) && readdirSync(dir).length === 0) {
    rmdirSync(dir);
    dir = dirname(dir);
  }
}

export async function syncModules(options: { app: string; config: string; check: boolean }): Promise<SyncResult> {
  const appDir = join(ROOT, 'apps', options.app);
  const configFile = join(appDir, `modules.config.${options.config}.ts`);
  if (!existsSync(configFile)) throw new Error(`missing ${relative(ROOT, configFile)}`);
  const config = (await import(pathToFileURL(configFile).href)).default as AppConfig;

  // Resolve packages from the app, so the app's package.json is the source of what can be enabled.
  const requireFromApp = createRequire(join(appDir, 'package.json'));
  const load = async (spec: string) => import(pathToFileURL(requireFromApp.resolve(spec)).href);
  const api = (await load('@ecomkit/core/manifest')) as ManifestApi;
  const manifests: ModuleManifest[] = [];
  for (const id of config.modules) {
    try {
      manifests.push((await load(`@ecomkit/${id}/manifest`)).default as ModuleManifest);
    } catch (err) {
      throw new Error(`cannot load @ecomkit/${id}/manifest from apps/${options.app}: ${(err as Error).message}`);
    }
  }
  const ordered = api.resolveModules(manifests, config.modules);
  const plan = api.planFiles(config, ordered);

  const result: SyncResult = { written: [], removed: [], keptHandWritten: [], planned: plan.map((f) => f.path) };
  for (const file of plan) {
    const full = join(appDir, file.path);
    const current = existsSync(full) ? readFileSync(full, 'utf8') : null;
    if (current !== null && !current.startsWith(api.GENERATED_HEADER)) {
      result.keptHandWritten.push(file.path);
      continue;
    }
    if (current === file.contents) continue;
    result.written.push(file.path);
    if (!options.check) {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, file.contents);
    }
  }
  const plannedSet = new Set(result.planned);
  for (const path of generatedFiles(appDir, api.GENERATED_HEADER)) {
    if (plannedSet.has(path)) continue;
    result.removed.push(path);
    if (!options.check) {
      unlinkSync(join(appDir, path));
      pruneEmptyDirs(dirname(join(appDir, path)), join(appDir, 'app'));
    }
  }
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const list = process.argv.includes('--list');
  // --list is read-only: it runs the planner in check mode (never writes) and prints the plan.
  const options = { app: arg('app', 'shop'), config: arg('config', 'dev'), check: process.argv.includes('--check') || list };
  try {
    const r = await syncModules(options);
    if (list) {
      for (const p of r.planned) console.log(p);
      console.log(`modules:sync ${options.app} (${options.config}): ${r.planned.length} planned`);
      process.exit(0);
    }
    const verb = options.check ? 'would write' : 'wrote';
    for (const p of r.written) console.log(`${verb} ${p}`);
    for (const p of r.removed) console.log(`${options.check ? 'would remove' : 'removed'} ${p}`);
    for (const p of r.keptHandWritten) console.log(`kept hand-written ${p}`);
    const drift = r.written.length + r.removed.length;
    console.log(`modules:sync ${options.app} (${options.config}): ${r.planned.length} planned, ${drift} ${options.check ? 'out of date' : 'changed'}`);
    if (options.check && drift > 0) process.exit(1);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
