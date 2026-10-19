import { getViewer } from '@ecomkit/core/auth-context';
import type { Registry } from '@ecomkit/core/manifest';
import { captureError } from '@ecomkit/core/observability';
import { searchHitSchema, searchProviders, searchQuerySchema, type AdminSearchHit } from '../domain';

export interface SearchGroup {
  id: string;
  label: string;
  hits: AdminSearchHit[];
}

/** True when at least one enabled module offers admin search to this viewer (the top bar hides the box otherwise). */
export function hasSearch(registry: Registry, permissions: readonly string[]): boolean {
  return searchProviders(registry.modules).some((p) => permissions.includes(p.permission));
}

/**
 * Global admin search (top bar): every provider the viewer may use runs in parallel, 5 hits each.
 * A failing provider is logged and left out; the others still answer. Hits are validated (admin links only).
 */
export async function searchAdmin(registry: Registry, rawQuery: unknown): Promise<SearchGroup[]> {
  const viewer = await getViewer();
  const query = searchQuerySchema.safeParse(rawQuery);
  if (viewer.kind !== 'staff' || !query.success) return [];
  const providers = searchProviders(registry.modules).filter((p) => viewer.permissions.includes(p.permission));
  const settled = await Promise.allSettled(providers.map(async (p) => (await p.search())(query.data, 5)));
  const groups: SearchGroup[] = [];
  for (const [i, p] of providers.entries()) {
    const r = settled[i]!;
    if (r.status === 'rejected') {
      await captureError(r.reason, { route: 'admin-search', level: 'warning' });
      continue;
    }
    const hits = (Array.isArray(r.value) ? r.value : []).flatMap((h) => {
      const parsed = searchHitSchema.safeParse(h);
      return parsed.success ? [parsed.data] : [];
    });
    if (hits.length) groups.push({ id: p.id, label: p.label, hits: hits.slice(0, 5) });
  }
  return groups;
}
