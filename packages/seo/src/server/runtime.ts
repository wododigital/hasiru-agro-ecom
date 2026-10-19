import type { ImageRef, ModuleId, SitemapSource } from '@ecomkit/core/contracts';
import { env } from '@ecomkit/core/env';
import { siteIdentity, type LlmsSection, type SiteIdentity, type SiteIdentityInput } from '../domain';
import { mergeSeoMessages, type SeoMessages, type SeoMessagesOverride } from '../messages';

/** The part of the app registry seo reads. */
export interface SeoRegistry {
  list(key: 'sitemapSources'): readonly (SitemapSource & { moduleId: ModuleId })[];
}

/** What the OG route draws for a path. `imageUrl` must be absolute (it is fetched while rendering). */
export interface OgCard {
  title: string;
  subtitle?: string | null;
  eyebrow?: string | null;
  imageUrl?: string | null;
}

/** For the product form SEO tab: where an entity lives and what it currently says. */
export interface EntitySeo {
  path: string;
  title: string;
  description: string;
  noindex: boolean;
}

/**
 * Everything seo takes from the host app, bound once at boot (instrumentation or the root layout), like core's
 * setAuthProvider. Route stubs only re-export seo handlers. Every field is optional: unbound capabilities fall back
 * to generic output (SITE_URL origin, no extra sitemap files, a plain OG card).
 */
export interface SeoRuntimeInput {
  site?: SiteIdentityInput;
  registry?: SeoRegistry | null;
  /** Added to DEFAULT_DISALLOW in robots.txt (e.g. module-owned private paths). */
  robotsDisallow?: readonly string[];
  /** false on staging: robots.txt disallows everything. */
  allowIndexing?: boolean;
  /** Host-written llms.txt sections (how to buy, contact); sitemap files are appended as link lists. */
  llms?: { sections?: readonly LlmsSection[]; sourceTitles?: Readonly<Record<string, string>>; maxLinksPerSection?: number };
  /** OG card for a path (e.g. a product with name and price); null falls back to page meta or the site name. */
  ogCard?: ((path: string) => Promise<OgCard | null>) | null;
  /** Colours for the OG card (the theme's values; satori cannot read CSS variables). */
  ogColors?: { background: string; foreground: string; accent: string };
  /** media: ImageRefs for asset ids (page meta social images). */
  images?: ((ids: readonly string[]) => Promise<Record<string, ImageRef>>) | null;
  /** catalog: the storefront path and current SEO text of a product (SEO tab). */
  entitySeo?: ((kind: 'product', id: string) => Promise<EntitySeo | null>) | null;
  /** Starting points on the 404 page (host copy). */
  notFoundLinks?: readonly { label: string; href: string }[];
  messages?: SeoMessagesOverride;
}

export interface SeoRuntime {
  site: SiteIdentity;
  registry: SeoRegistry | null;
  robotsDisallow: readonly string[];
  allowIndexing: boolean;
  llms: { sections: readonly LlmsSection[]; sourceTitles: Readonly<Record<string, string>>; maxLinksPerSection: number };
  ogCard: ((path: string) => Promise<OgCard | null>) | null;
  ogColors: { background: string; foreground: string; accent: string };
  images: ((ids: readonly string[]) => Promise<Record<string, ImageRef>>) | null;
  entitySeo: ((kind: 'product', id: string) => Promise<EntitySeo | null>) | null;
  notFoundLinks: readonly { label: string; href: string }[];
  messages: SeoMessages;
}

const KEY = Symbol.for('ecomkit.seo.runtime');
type Holder = { [KEY]?: SeoRuntime };

function build(input: SeoRuntimeInput): SeoRuntime {
  return {
    site: siteIdentity(input.site ?? { url: env.SITE_URL ?? 'http://localhost:3000', name: 'Store' }),
    registry: input.registry ?? null,
    robotsDisallow: input.robotsDisallow ?? [],
    allowIndexing: input.allowIndexing ?? true,
    llms: { sections: input.llms?.sections ?? [], sourceTitles: input.llms?.sourceTitles ?? {}, maxLinksPerSection: input.llms?.maxLinksPerSection ?? 100 },
    ogCard: input.ogCard ?? null,
    ogColors: input.ogColors ?? { background: 'white', foreground: 'black', accent: 'black' },
    images: input.images ?? null,
    entitySeo: input.entitySeo ?? null,
    notFoundLinks: input.notFoundLinks ?? [],
    messages: mergeSeoMessages(input.messages),
  };
}

/** Binds the host's capabilities (replaces any earlier binding). Kept on globalThis so every bundle sees one value. */
export function configureSeo(input: SeoRuntimeInput): void {
  (globalThis as Holder)[KEY] = build(input);
}

export function seoRuntime(): SeoRuntime {
  return ((globalThis as Holder)[KEY] ??= build({}));
}
