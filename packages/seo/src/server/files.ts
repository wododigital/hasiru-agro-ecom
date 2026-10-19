import type { SitemapEntry } from '@ecomkit/core/contracts';
import { captureError } from '@ecomkit/core/observability';
import { db } from '@ecomkit/core/db';
import { createElement as h } from 'react';
import {
  DEFAULT_DISALLOW,
  SITEMAP_NAME_RE,
  clip,
  llmsTxt,
  normalisePath,
  robotsTxt,
  sitemapIndexXml,
  sitemapUrls,
  urlsetXml,
  type LlmsSection,
} from '../domain';
import { seoRedirect } from '../schema';
import { getPageMeta, noindexPaths } from './page-meta';
import { seoRuntime, type OgCard } from './runtime';

const text = (body: string, type: string, maxAge = 3600) =>
  new Response(body, { headers: { 'content-type': `${type}; charset=utf-8`, 'cache-control': `public, max-age=${maxAge}` } });

/** "alphonso-mango" -> "Alphonso mango" (link text when a source only knows paths). */
export function titleFromPath(path: string): string {
  const last = path.split('/').filter(Boolean).pop() ?? '';
  const words = decodeURIComponent(last).replace(/[-_]+/g, ' ').trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : seoRuntime().site.name;
}

/** Every sitemap file the enabled modules contribute, entries already filtered (redirects, noindex, duplicates). */
export async function sitemapFiles(): Promise<{ name: string; entries: SitemapEntry[] }[]> {
  const sources = seoRuntime().registry?.list('sitemapSources') ?? [];
  const byName = new Map<string, SitemapEntry[]>();
  for (const s of sources) {
    if (!SITEMAP_NAME_RE.test(s.name)) continue;
    let entries: SitemapEntry[] = [];
    try {
      entries = await (await s.entries())();
    } catch (err) {
      // One broken source must not take the whole sitemap down.
      await captureError(err, { route: `/sitemap/${s.name}.xml` }).catch(() => undefined);
    }
    byName.set(s.name, [...(byName.get(s.name) ?? []), ...entries]);
  }
  const [redirected, noindex] = await Promise.all([
    db.select({ path: seoRedirect.fromPath }).from(seoRedirect).then((rows) => new Set(rows.map((r) => r.path))),
    noindexPaths(),
  ]);
  return [...byName].map(([name, entries]) => ({ name, entries: sitemapUrls(entries, { redirected, noindex }) })).sort((a, b) => a.name.localeCompare(b.name));
}

const newest = (entries: readonly SitemapEntry[]) =>
  entries.reduce<string | undefined>((max, e) => (e.lastModified && (!max || e.lastModified > max) ? e.lastModified : max), undefined);

/** GET /sitemap.xml: index of the non-empty per-source files. */
export async function sitemapIndexResponse(): Promise<Response> {
  const files = (await sitemapFiles()).filter((f) => f.entries.length);
  return text(sitemapIndexXml(seoRuntime().site, files.map((f) => ({ name: f.name, lastModified: newest(f.entries) }))), 'application/xml');
}

/** GET /sitemap/<name>.xml; 404 for an unknown or empty file. */
export async function sitemapFileResponse(file: string): Promise<Response> {
  const name = file.replace(/\.xml$/, '');
  if (!file.endsWith('.xml') || !SITEMAP_NAME_RE.test(name)) return new Response(null, { status: 404 });
  const match = (await sitemapFiles()).find((f) => f.name === name);
  if (!match?.entries.length) return new Response(null, { status: 404 });
  return text(urlsetXml(seoRuntime().site, match.entries), 'application/xml');
}

/** GET /robots.txt: private paths disallowed, AI crawlers allowed by name, sitemap line. */
export function robotsResponse(): Response {
  const rt = seoRuntime();
  return text(robotsTxt(rt.site, { disallow: [...DEFAULT_DISALLOW, ...rt.robotsDisallow], allowIndexing: rt.allowIndexing }), 'text/plain', 86_400);
}

/** GET /llms.txt: site summary, host sections, then each sitemap file as a link list. */
export async function llmsResponse(): Promise<Response> {
  const rt = seoRuntime();
  const files = await sitemapFiles();
  const generated: LlmsSection[] = files
    .filter((f) => f.entries.length)
    .map((f) => ({
      title: rt.llms.sourceTitles[f.name] ?? titleFromPath(`/${f.name}`),
      links: f.entries.slice(0, rt.llms.maxLinksPerSection).map((e) => ({ title: titleFromPath(e.path), path: e.path })),
    }));
  return text(llmsTxt(rt.site, [...rt.llms.sections, ...generated]), 'text/plain', 86_400);
}

/** The card for a path: host resolver, else the admin's page meta title, else the path's last segment. */
export async function ogCardFor(path: string): Promise<OgCard> {
  const rt = seoRuntime();
  const fromHost = rt.ogCard ? await rt.ogCard(path).catch(() => null) : null;
  if (fromHost) return fromHost;
  const meta = await getPageMeta(path);
  if (path === '/') return { title: rt.site.name, subtitle: rt.site.description || null };
  return { title: meta?.title || titleFromPath(path), subtitle: meta?.description ?? null };
}

/** GET /og/<path...>: a 1200x630 PNG card (`/og/home` is the home page). */
export async function ogResponse(segments: readonly string[]): Promise<Response> {
  const joined = `/${segments.join('/')}`;
  const path = joined === '/home' ? '/' : normalisePath(joined);
  if (!path || segments.length > 8) return new Response(null, { status: 404 });
  const card = await ogCardFor(path);
  const { site, ogColors: c } = seoRuntime();
  const { ImageResponse } = await import('next/og');
  const column = h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flex: 1, padding: 64 } },
    h('div', { style: { fontSize: 30, color: c.accent, letterSpacing: 1 } }, card.eyebrow ?? site.name),
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: 20 } },
      h('div', { style: { fontSize: card.title.length > 40 ? 56 : 72, lineHeight: 1.1, color: c.foreground } }, clip(card.title, 90)),
      card.subtitle ? h('div', { style: { fontSize: 32, lineHeight: 1.3, color: c.foreground, opacity: 0.8 } }, clip(card.subtitle, 140)) : null,
    ),
    h('div', { style: { fontSize: 26, color: c.foreground, opacity: 0.7 } }, new URL(site.url).host),
  );
  const image = card.imageUrl
    ? h('img', { src: card.imageUrl, width: 480, height: 630, style: { objectFit: 'cover', width: 480, height: 630 } })
    : null;
  const res = new ImageResponse(h('div', { style: { display: 'flex', width: '100%', height: '100%', background: c.background } }, column, image), {
    width: 1200,
    height: 630,
  });
  res.headers.set('cache-control', 'public, max-age=86400, stale-while-revalidate=604800');
  return res;
}
