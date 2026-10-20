import { PERMISSIONS, type ModuleManifest } from '@ecomkit/core/contracts';
import { z } from 'zod';

/**
 * Three admin extension points the frozen manifest contract does not name yet (requested for core contracts in
 * BUILD-STATUS/wp-08.md). A module adds them as extra manifest keys; admin-shell reads them structurally and
 * validates them with zod here, so a malformed entry is dropped instead of breaking the admin.
 *
 *   adminSearch: [{ id, label, order, permission, search: () => import('./server/search').then((m) => m.search) }]
 *   settingsUrls: [{ label, path, help? }]   copyable webhook / redirect URLs on the module's settings page
 *   adminTodos: [{ id, label, href, order, permission, count: () => import('./admin/todos').then((m) => m.x) }]
 *                                            Home "Things to do": a count of items needing action, linking to the
 *                                            filtered index (shown only when the count is above zero)
 */

export interface AdminSearchHit {
  id: string;
  title: string;
  subtitle?: string;
  /** Admin path, e.g. /admin/orders/<id>. */
  href: string;
}
export interface AdminSearchProvider {
  id: string;
  /** Group heading in the results, e.g. "Orders". */
  label: string;
  order: number;
  permission: (typeof PERMISSIONS)[number];
  search: () => Promise<(query: string, limit: number) => Promise<AdminSearchHit[]>>;
}
export interface AdminTodo {
  id: string;
  /** Plural noun phrase after the count, e.g. "orders to dispatch". */
  label: string;
  /** The filtered index, e.g. /admin/orders?view=unfulfilled. */
  href: string;
  order: number;
  permission: (typeof PERMISSIONS)[number];
  count: () => Promise<() => Promise<number>>;
}
export interface SettingsUrl {
  label: string;
  /** Path on the canonical host (absolute URLs are shown as they are). */
  path: string;
  help?: string;
}

const providerSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  order: z.number(),
  permission: z.enum(PERMISSIONS),
  search: z.custom<AdminSearchProvider['search']>((v) => typeof v === 'function'),
});
const todoSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  href: z.string().regex(/^\/admin(\/|$|\?)/),
  order: z.number(),
  permission: z.enum(PERMISSIONS),
  count: z.custom<AdminTodo['count']>((v) => typeof v === 'function'),
});
const urlSchema = z.object({ label: z.string().min(1), path: z.string().regex(/^(\/|https:\/\/)/), help: z.string().optional() });

export const searchHitSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200),
  subtitle: z.string().max(200).optional(),
  href: z.string().regex(/^\/admin(\/|$)/),
});

function validList<T>(raw: unknown, schema: z.ZodType<T>): T[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export function searchProviders(modules: readonly ModuleManifest[]): (AdminSearchProvider & { moduleId: string })[] {
  return modules
    .flatMap((m) => validList((m as { adminSearch?: unknown }).adminSearch, providerSchema).map((p) => ({ ...p, moduleId: m.id })))
    .sort((a, b) => a.order - b.order);
}

export function todoProviders(modules: readonly ModuleManifest[]): (AdminTodo & { moduleId: string })[] {
  return modules
    .flatMap((m) => validList((m as { adminTodos?: unknown }).adminTodos, todoSchema).map((t) => ({ ...t, moduleId: m.id })))
    .sort((a, b) => a.order - b.order);
}

export function settingsUrls(manifest: ModuleManifest | undefined): SettingsUrl[] {
  return validList((manifest as { settingsUrls?: unknown } | undefined)?.settingsUrls, urlSchema);
}

/** Absolute URL for a copyable path; relative when the canonical origin is not configured (local dev). */
export function absoluteUrl(path: string, origin: string | null | undefined): string {
  if (/^https:\/\//.test(path) || !origin) return path;
  return new URL(path, origin).toString();
}

export const searchQuerySchema = z.string().trim().min(2).max(100);

// ---- dashboard range (one implementation, in ui: Home, Analytics and report pages share it) ----------------
export { compareRange, istDate, parseCompare, parseRange, type CompareMode } from '@ecomkit/ui/domain';
