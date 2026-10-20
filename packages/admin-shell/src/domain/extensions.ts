import { PERMISSIONS, type DateRange, type ModuleManifest } from '@ecomkit/core/contracts';
import { z } from 'zod';

/**
 * Two admin extension points the frozen manifest contract does not name yet (requested for core contracts in
 * BUILD-STATUS/wp-08.md). A module adds them as extra manifest keys; admin-shell reads them structurally and
 * validates them with zod here, so a malformed entry is dropped instead of breaking the admin.
 *
 *   adminSearch: [{ id, label, order, permission, search: () => import('./server/search').then((m) => m.search) }]
 *   settingsUrls: [{ label, path, help? }]   copyable webhook / redirect URLs on the module's settings page
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

export function settingsUrls(manifest: ModuleManifest | undefined): SettingsUrl[] {
  return validList((manifest as { settingsUrls?: unknown } | undefined)?.settingsUrls, urlSchema);
}

/** Absolute URL for a copyable path; relative when the canonical origin is not configured (local dev). */
export function absoluteUrl(path: string, origin: string | null | undefined): string {
  if (/^https:\/\//.test(path) || !origin) return path;
  return new URL(path, origin).toString();
}

export const searchQuerySchema = z.string().trim().min(2).max(100);

// ---- dashboard range ----------------------------------------------------------

const isoDate = z.iso.date();

/** Today's date in India (YYYY-MM-DD). */
export function istDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Dashboard range from `?from=&to=`: valid dates, from <= to, at most 366 days; else the last 30 days in IST. */
export function parseRange(input: { from?: unknown; to?: unknown }, now: Date): DateRange {
  const today = istDate(now);
  const fallback = { from: shiftDays(today, -29), to: today };
  const from = isoDate.safeParse(input.from);
  const to = isoDate.safeParse(input.to);
  if (!from.success || !to.success || from.data > to.data) return fallback;
  if (shiftDays(from.data, 366) <= to.data) return fallback;
  return { from: from.data, to: to.data };
}

export type CompareMode = 'previous-period' | 'previous-year' | 'none';

/** Comparison window for the Home and Analytics date range: the same-length period before, or the same dates a year back. */
export function compareRange(range: DateRange, mode: CompareMode): DateRange | null {
  if (mode === 'none') return null;
  if (mode === 'previous-year') return { from: shiftDays(range.from, -365), to: shiftDays(range.to, -365) };
  const days = Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86_400_000) + 1;
  return { from: shiftDays(range.from, -days), to: shiftDays(range.from, -1) };
}

export const parseCompare = (v: unknown): CompareMode => (v === 'previous-year' || v === 'none' ? v : 'previous-period');
