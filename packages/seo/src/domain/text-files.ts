import type { SitemapEntry } from '@ecomkit/core/contracts';
import { canonicalUrl, normalisePath } from './paths';
import type { SiteIdentity } from './site';

/** Sitemap file names are `/sitemap/<name>.xml`. */
export const SITEMAP_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Protocol limit per file. */
export const SITEMAP_MAX_URLS = 50_000;

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export interface SitemapExclusions {
  /** Paths that redirect (they do not return 200). */
  redirected: ReadonlySet<string>;
  /** Paths an admin marked noindex in page meta. */
  noindex: ReadonlySet<string>;
}

/**
 * What a sitemap may list: valid canonical paths only, never a redirect source or a noindex override, no
 * query strings, no duplicates (first wins), at most 50k. Sources already list only published, indexable
 * rows; this is the second gate.
 */
export function sitemapUrls(entries: readonly SitemapEntry[], exclude: SitemapExclusions): SitemapEntry[] {
  const out = new Map<string, SitemapEntry>();
  for (const e of entries) {
    if (e.path.includes('?') || e.path.includes('#')) continue;
    const path = normalisePath(e.path);
    if (!path || out.has(path) || exclude.redirected.has(path) || exclude.noindex.has(path)) continue;
    out.set(path, { ...e, path });
    if (out.size >= SITEMAP_MAX_URLS) break;
  }
  return [...out.values()];
}

const lastmod = (iso: string | undefined) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

export function urlsetXml(site: Pick<SiteIdentity, 'url'>, entries: readonly SitemapEntry[]): string {
  const rows = entries.map((e) => {
    const parts = [`<loc>${xml(canonicalUrl(site, e.path))}</loc>`];
    const lm = lastmod(e.lastModified);
    if (lm) parts.push(`<lastmod>${lm}</lastmod>`);
    if (e.changeFrequency) parts.push(`<changefreq>${e.changeFrequency}</changefreq>`);
    if (e.priority != null) parts.push(`<priority>${Math.min(1, Math.max(0, e.priority)).toFixed(1)}</priority>`);
    return `<url>${parts.join('')}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join('\n')}\n</urlset>\n`;
}

export function sitemapIndexXml(site: Pick<SiteIdentity, 'url'>, files: readonly { name: string; lastModified?: string }[]): string {
  const rows = files.map((f) => {
    const lm = lastmod(f.lastModified);
    return `<sitemap><loc>${xml(`${site.url}/sitemap/${f.name}.xml`)}</loc>${lm ? `<lastmod>${lm}</lastmod>` : ''}</sitemap>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join('\n')}\n</sitemapindex>\n`;
}

/** Crawlers named with an explicit Allow (answer engines and AI training opt-in stay visible). */
export const AI_CRAWLERS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended'] as const;

/** Private and duplicate surfaces every store keeps out of the index; hosts add their own. */
export const DEFAULT_DISALLOW = ['/cart', '/checkout', '/account', '/admin', '/api/', '/search', '/pay/', '/order/'] as const;

export function robotsTxt(site: Pick<SiteIdentity, 'url'>, options: { disallow: readonly string[]; allowIndexing: boolean }): string {
  if (!options.allowIndexing) return 'User-agent: *\nDisallow: /\n';
  const disallow = [...new Set(options.disallow)].map((p) => `Disallow: ${p}`);
  const blocks = [['User-agent: *', 'Allow: /', ...disallow], ...AI_CRAWLERS.map((bot) => [`User-agent: ${bot}`, 'Allow: /', ...disallow])];
  return `${blocks.map((b) => b.join('\n')).join('\n\n')}\n\nSitemap: ${site.url}/sitemap.xml\n`;
}

export interface LlmsSection {
  title: string;
  /** Plain text paragraph shown under the heading. */
  body?: string;
  links?: readonly { title: string; path: string; note?: string }[];
}

/** llms.txt (llmstxt.org): H1 name, blockquote summary, then H2 sections of links. */
export function llmsTxt(site: Pick<SiteIdentity, 'url' | 'name' | 'description'>, sections: readonly LlmsSection[]): string {
  const md = (s: string) => s.replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim();
  const out = [`# ${md(site.name)}`, ''];
  if (site.description) out.push(`> ${md(site.description)}`, '');
  for (const s of sections) {
    if (!s.body && !s.links?.length) continue;
    out.push(`## ${md(s.title)}`, '');
    if (s.body) out.push(s.body.trim(), '');
    for (const l of s.links ?? []) out.push(`- [${md(l.title)}](${canonicalUrl(site, l.path)})${l.note ? `: ${md(l.note)}` : ''}`);
    if (s.links?.length) out.push('');
  }
  return `${out.join('\n').trim()}\n`;
}
