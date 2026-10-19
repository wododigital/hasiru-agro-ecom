import type { ModuleId, ModuleManifest, RouteDef } from '../contracts';
import { routeFilePath } from './paths';

export class ModuleConfigError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`module config invalid:\n- ${problems.join('\n- ')}`);
    this.name = 'ModuleConfigError';
    this.problems = problems;
  }
}

const ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const PATH_RE = /^\/$|^(?:\/[A-Za-z0-9._()\-[\]]+)+$/;
const HTTP_EXPORTS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

function checkRoute(owner: string, route: RouteDef, problems: string[]): void {
  if (!PATH_RE.test(route.path)) problems.push(`${owner}: invalid route path "${route.path}"`);
  if (route.module.startsWith('.') || route.module.startsWith('/') || route.module.includes('src/'))
    problems.push(`${owner}: route module "${route.module}" must be a package export subpath like "routes/product-page"`);
  if (route.exports.length === 0) problems.push(`${owner}: route ${route.path} exports nothing`);
  if (route.kind === 'page' && !route.exports.includes('default')) problems.push(`${owner}: page ${route.path} must export default`);
  if (route.kind === 'route' && route.exports.some((e) => !HTTP_EXPORTS.has(e)))
    problems.push(`${owner}: route handler ${route.path} may only export HTTP methods`);
}

/**
 * Validates the enabled set and returns manifests in dependency order (core first).
 * Ordering follows `dependsOn` only; optional links may point both ways.
 */
export function resolveModules(available: readonly ModuleManifest[], enabled: readonly ModuleId[]): ModuleManifest[] {
  const problems: string[] = [];
  const byId = new Map<ModuleId, ModuleManifest>();
  for (const m of available) {
    if (byId.has(m.id)) problems.push(`duplicate manifest id "${m.id}"`);
    byId.set(m.id, m);
  }

  const enabledSet = new Set(enabled);
  if (enabledSet.size !== enabled.length) problems.push('a module is listed twice in the app config');
  if (!enabledSet.has('core')) problems.push('core must be enabled');
  for (const id of enabled) {
    if (!ID_RE.test(id)) problems.push(`module id "${id}" is not kebab-case`);
    if (!byId.has(id)) problems.push(`unknown module "${id}" (no manifest loaded)`);
  }
  for (const id of enabled) {
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      if (!enabledSet.has(dep)) problems.push(`${id} depends on ${dep}, which is not enabled`);
    }
  }
  if (problems.length) throw new ModuleConfigError(problems);

  // Depth-first topological order, stable by config order.
  const ordered: ModuleManifest[] = [];
  const state = new Map<ModuleId, 'visiting' | 'done'>();
  const visit = (id: ModuleId, chain: ModuleId[]): void => {
    const s = state.get(id);
    if (s === 'done') return;
    if (s === 'visiting') {
      problems.push(`dependency cycle: ${[...chain, id].join(' -> ')}`);
      return;
    }
    state.set(id, 'visiting');
    const m = byId.get(id)!;
    for (const dep of m.dependsOn) visit(dep, [...chain, id]);
    state.set(id, 'done');
    ordered.push(m);
  };
  visit('core', []);
  for (const id of enabled) visit(id, []);

  const files = new Map<string, string>();
  const providers = new Map<string, string>();
  for (const m of ordered) {
    const claim = (route: RouteDef) => {
      const file = routeFilePath(route);
      const prev = files.get(file);
      if (prev) problems.push(`${m.id} and ${prev} both declare ${file}`);
      else files.set(file, m.id);
    };
    for (const r of m.routes ?? []) {
      checkRoute(m.id, r, problems);
      if (r.path.startsWith('/api/_mock/')) problems.push(`${m.id}: ${r.path} belongs in mockRoutes`);
      claim(r);
    }
    for (const r of m.mockRoutes ?? []) {
      checkRoute(m.id, r, problems);
      if (!r.path.startsWith('/api/_mock/') || r.kind !== 'route')
        problems.push(`${m.id}: mock route ${r.path} must be a route handler under /api/_mock/`);
      claim(r);
    }
    for (const r of m.admin?.pages ?? []) {
      checkRoute(m.id, r, problems);
      if (r.kind !== 'page' || !(r.path === '/admin' || r.path.startsWith('/admin/')))
        problems.push(`${m.id}: admin page ${r.path} must be a page under /admin`);
      if (r.path.startsWith('/admin/settings')) problems.push(`${m.id}: ${r.path} is rendered by admin-shell from the manifest settings`);
      claim(r);
    }
    for (const item of m.admin?.nav ?? []) {
      if (!Number.isInteger(item.order) || item.order < 0 || item.order > 999)
        problems.push(`${m.id}: nav "${item.label}" order ${item.order} is outside 0..999`);
    }
    const jobNames = Object.keys(m.jobs ?? {});
    for (const name of jobNames) {
      if (!name.startsWith(`${m.id}.`)) problems.push(`${m.id}: job "${name}" must be named "${m.id}.<name>"`);
    }
    for (const s of m.schedules ?? []) {
      if (!jobNames.includes(s.job)) problems.push(`${m.id}: schedule references unknown job "${s.job}"`);
    }
    for (const key of Object.keys(m.provides ?? {})) {
      const prev = providers.get(key);
      if (prev) problems.push(`${m.id} and ${prev} both provide service "${key}"`);
      else providers.set(key, m.id);
    }
  }
  if (problems.length) throw new ModuleConfigError(problems);
  return ordered;
}
