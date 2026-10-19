import type { ImageRef, JsonLdBuilders, MetadataInput, ModuleId, ProductCardChipSource, PdpSection, ProductFormTab, ServiceKey, ServiceMap } from '@ecomkit/core/contracts';
import type { Metadata } from 'next';
import type { ComponentType } from 'react';
import { mergeMessages, type CatalogMessages, type CatalogMessagesOverride } from '../messages';

/** The part of the app registry the catalog reads (optional modules, extension points). */
export interface CatalogRegistry {
  has(id: ModuleId): boolean;
  service<K extends ServiceKey>(key: K): Promise<ServiceMap[K] | null>;
  list(key: 'pdpSections'): readonly (PdpSection & { moduleId: ModuleId })[];
  list(key: 'productCardChips'): readonly (ProductCardChipSource & { moduleId: ModuleId })[];
  list(key: 'productFormTabs'): readonly (ProductFormTab & { moduleId: ModuleId })[];
}

export interface ListingAsideProps {
  productIds: readonly string[];
  collectionSlug: string | null;
}

/**
 * Everything the catalog takes from the host app. Route stubs only re-export catalog pages, so the app binds
 * these once at boot (instrumentation or the root layout), like core's setAuthProvider. Every field is optional:
 * an unbound capability renders nothing (no images -> leaf placeholder, no seo -> no JSON-LD, no registry -> no
 * optional modules).
 */
export interface CatalogRuntimeInput {
  registry?: CatalogRegistry | null;
  /** media: ImageRefs for media asset ids (missing ids are absent from the record). */
  images?: ((mediaIds: readonly string[]) => Promise<Record<string, ImageRef>>) | null;
  /** media: asset ids for master files under data/media/masters (seed import), keyed by the relative path. */
  resolveMediaIds?: ((srcs: readonly string[]) => Promise<Record<string, string>>) | null;
  /** seo: JSON-LD builders (`jsonLd`), metadata builder and the redirect writer. */
  jsonLd?: JsonLdBuilders | null;
  metadata?: ((input: MetadataInput) => Metadata) | null;
  addRedirect?: ((fromPath: string, toPath: string) => Promise<void>) | null;
  /** The visitor's district slug (places/planting set it); default reads the `district` cookie. */
  readDistrict?: (() => Promise<string | null>) | null;
  /** Rendered beside listings (the search module's facet sidebar). */
  listingAside?: ComponentType<ListingAsideProps> | null;
  messages?: CatalogMessagesOverride;
  now?: () => Date;
}

export interface CatalogRuntime extends Required<Omit<CatalogRuntimeInput, 'messages' | 'readDistrict'>> {
  messages: CatalogMessages;
  readDistrict: () => Promise<string | null>;
}

const KEY = Symbol.for('ecomkit.catalog.runtime');
type Holder = { [KEY]?: CatalogRuntime };

async function districtFromCookie(): Promise<string | null> {
  try {
    const { cookies } = await import('next/headers');
    const v = (await cookies()).get('district')?.value ?? null;
    return v && /^[a-z0-9-]{2,60}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

function build(input: CatalogRuntimeInput): CatalogRuntime {
  return {
    registry: input.registry ?? null,
    images: input.images ?? null,
    resolveMediaIds: input.resolveMediaIds ?? null,
    jsonLd: input.jsonLd ?? null,
    metadata: input.metadata ?? null,
    addRedirect: input.addRedirect ?? null,
    readDistrict: input.readDistrict ?? districtFromCookie,
    listingAside: input.listingAside ?? null,
    messages: mergeMessages(input.messages),
    now: input.now ?? (() => new Date()),
  };
}

/** Binds the host's capabilities (replaces any earlier binding). Kept on globalThis so every bundle sees one value. */
export function configureCatalog(input: CatalogRuntimeInput): void {
  (globalThis as Holder)[KEY] = build(input);
}

export function catalogRuntime(): CatalogRuntime {
  return ((globalThis as Holder)[KEY] ??= build({}));
}

/** An optional service, or null when the module is off or no registry is bound. */
export async function optionalService<K extends ServiceKey>(key: K): Promise<ServiceMap[K] | null> {
  const r = catalogRuntime().registry;
  return r ? r.service(key) : null;
}
