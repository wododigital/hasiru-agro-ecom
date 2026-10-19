import type { SiteIdentity } from './site';

/** Prefixes whose case is meaningful (tokens, files); same list the request proxy exempts from lowercasing. */
export const CASE_EXEMPT_PREFIXES = ['/_next/', '/api/', '/media/', '/r/', '/order/', '/feeds/', '/og/'] as const;

/**
 * A site path in canonical form, or null when it is not one: leading slash, no query or hash, no trailing
 * slash (except "/"), no "//" or "..", letters lowercased outside percent-escapes (except exempt prefixes),
 * at most 512 chars. Absolute URLs on any host are reduced to their path.
 */
export function normalisePath(input: string): string | null {
  let raw = input.trim();
  if (/^https?:\/\//i.test(raw)) {
    try {
      raw = new URL(raw).pathname;
    } catch {
      return null;
    }
  }
  raw = raw.replace(/[?#].*$/, '');
  if (!raw.startsWith('/') || raw.startsWith('//') || /\s/.test(raw) || raw.length > 512) return null;
  if (raw.split('/').some((s) => s === '..' || s === '.')) return null;
  let path = raw.length > 1 ? raw.replace(/\/+$/, '') || '/' : raw;
  if (/\/\//.test(path)) return null;
  const exempt = CASE_EXEMPT_PREFIXES.some((p) => path === p.slice(0, -1) || path.startsWith(p));
  if (!exempt) path = path.replace(/%[0-9A-Fa-f]{2}|[^%]+/g, (c) => (c.startsWith('%') ? c.toUpperCase() : c.toLowerCase()));
  return path;
}

/**
 * Canonical absolute URL: pinned origin, no trailing slash, no query; paginated listings keep `?page=n` (n > 1)
 * in their own canonical.
 */
export function canonicalUrl(site: Pick<SiteIdentity, 'url'>, path: string, options: { page?: number } = {}): string {
  const clean = normalisePath(path) ?? '/';
  const page = options.page && options.page > 1 ? `?page=${Math.floor(options.page)}` : '';
  return `${site.url}${clean === '/' ? '/' : clean}${page}`;
}

/** Same path under the reserved Kannada prefix. */
export function localisedPath(path: string, locale: 'en-IN' | 'kn-IN'): string {
  if (locale === 'en-IN') return path;
  return path === '/' ? '/kn' : `/kn${path}`;
}
