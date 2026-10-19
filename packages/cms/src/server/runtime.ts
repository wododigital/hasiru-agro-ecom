import type { ImageRef, JsonLdBuilders, MetadataInput } from '@ecomkit/core/contracts';
import type { Metadata } from 'next';
import { mergeCmsMessages, type CmsMessages, type CmsMessagesOverride } from '../messages';

/**
 * Everything cms takes from the host app, bound once at boot like core's setAuthProvider (route stubs only
 * re-export cms pages). Every field is optional: no images -> leaf placeholders, no seo -> plain title metadata
 * and no JSON-LD, no onMissing -> plain 404.
 */
export interface CmsRuntimeInput {
  /** media: ImageRefs for asset ids (missing ids are absent). */
  images?: ((ids: readonly string[]) => Promise<Record<string, ImageRef>>) | null;
  /** media: asset ids for master files (seed: trust claim logos), keyed by relative path. */
  resolveMediaIds?: ((srcs: readonly string[]) => Promise<Record<string, string>>) | null;
  /** seo: `buildMetadata`. */
  metadata?: ((input: MetadataInput) => Metadata) | null;
  /** seo: `jsonLd` (builders for the bound site). */
  jsonLd?: (() => JsonLdBuilders) | null;
  /** seo: `resolveMissing` (redirect or logged 404) for paths the catch-all cannot serve. */
  onMissing?: ((path: string) => Promise<never>) | null;
  /** seo: `addRedirect`, called when a published page or guide changes its address. */
  addRedirect?: ((fromPath: string, toPath: string) => Promise<unknown>) | null;
  messages?: CmsMessagesOverride;
}

export interface CmsRuntime extends Required<Omit<CmsRuntimeInput, 'messages'>> {
  messages: CmsMessages;
}

const KEY = Symbol.for('ecomkit.cms.runtime');
type Holder = { [KEY]?: CmsRuntime };

function build(input: CmsRuntimeInput): CmsRuntime {
  return {
    images: input.images ?? null,
    resolveMediaIds: input.resolveMediaIds ?? null,
    metadata: input.metadata ?? null,
    jsonLd: input.jsonLd ?? null,
    onMissing: input.onMissing ?? null,
    addRedirect: input.addRedirect ?? null,
    messages: mergeCmsMessages(input.messages),
  };
}

/** Binds the host's capabilities (replaces any earlier binding). Kept on globalThis so every bundle sees one value. */
export function configureCms(input: CmsRuntimeInput): void {
  (globalThis as Holder)[KEY] = build(input);
}

export function cmsRuntime(): CmsRuntime {
  return ((globalThis as Holder)[KEY] ??= build({}));
}

/** ImageRefs for ids through the bound media capability (empty when media is not bound). */
export async function imagesFor(ids: readonly (string | null | undefined)[]): Promise<Record<string, ImageRef>> {
  const wanted = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  const images = cmsRuntime().images;
  return wanted.length && images ? images(wanted) : {};
}
