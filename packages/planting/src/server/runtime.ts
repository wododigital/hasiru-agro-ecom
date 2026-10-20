import 'server-only';
import type { CartLineOrigin, ImageRef, ModuleId, PlacesReader, PlantClimate, PricingReader, Role } from '@ecomkit/core/contracts';
import { imagesFor, listProducts, mainMediaIds } from '@ecomkit/catalog/server';
import { places as placesReader } from '@ecomkit/places/server';
import { pricingReader } from '@ecomkit/pricing/server';
import { plantingMessages, type PlantingMessages } from '../messages';

/** What planting needs to know about a catalog plant (read through the catalog's public server API). */
export interface PlantFacts {
  productId: string;
  slug: string;
  href: string;
  name: string;
  nameKn: string | null;
  /** Display group on the results page (the top collection: Timber Trees, Fruiting Trees, Other Plants). */
  group: string;
  subcategory: string | null;
  sizeClass: string | null;
  variantId: string | null;
  climate: PlantClimate | null;
  bearingYearsMin: number | null;
  yieldText: string | null;
  image: ImageRef | null;
}

/** Cart (WP-17 `replacePackage`): one planting package per cart, replaced on every add. */
export interface CartPackagePort {
  replacePackage(input: {
    packageKey: string;
    label: string;
    lines: readonly { productId: string; variantId: string; qty: number; origin: CartLineOrigin }[];
  }): Promise<{ ok: boolean }>;
}

export interface InputLine {
  productId: string;
  variantId: string;
  name: string;
  packLabel: string | null;
  qty: number;
  unitPaise: number | null;
}

/** Farm calculators (WP-25 recommended inputs engine): input packs for a set of plant lines. */
export interface InputsPort {
  recommend(input: { lines: readonly { productId: string; role: Role; qty: number }[]; sqft: number }): Promise<InputLine[]>;
}

/** Auth (WP-02 `sendOtp` / `verifyOtp`): verify signs the customer in and returns the Set-Cookie headers. */
export interface OtpPort {
  send(input: { identifier: string; ip: string | null }): Promise<{ status: string }>;
  verify(input: { identifier: string; code: string; requestHeaders: Headers }): Promise<{ status: 'ok'; userId: string; headers: Headers } | { status: string }>;
}

export interface ModelVideo {
  id: string;
  title: string;
  url: string;
}

type Overrides = { [S in keyof PlantingMessages]?: Partial<PlantingMessages[S]> };

export interface PlantingRuntimeInput {
  /** The app registry: `has('planting-3d')` shows "View in 3D", `has('cart')` the package button. */
  registry?: { has(id: ModuleId): boolean } | null;
  products?: (ids: readonly string[]) => Promise<PlantFacts[]>;
  places?: PlacesReader;
  pricing?: PricingReader | null;
  cart?: CartPackagePort | null;
  inputs?: InputsPort | null;
  /** cms `videosFor({ modelSlug })`, mapped to `ModelVideo`. */
  videos?: ((modelSlug: string) => Promise<ModelVideo[]>) | null;
  otp?: OtpPort | null;
  /** Product ids of nitrogen fixers (companion ranking). Default: the catalog `nitrogen-fixing` tag. */
  nitrogenFixers?: () => Promise<ReadonlySet<string>>;
  /** Seed: catalog product id per product sku. */
  productIdsBySku?: ((skus: readonly string[]) => Promise<Record<string, string>>) | null;
  messages?: Overrides;
}

export interface PlantingRuntime extends Required<Omit<PlantingRuntimeInput, 'messages'>> {
  messages: PlantingMessages;
}

/** Default facts: catalog listing rows (visible products only) plus their main images. */
async function catalogFacts(ids: readonly string[]): Promise<PlantFacts[]> {
  if (!ids.length) return [];
  const [{ rows }, media] = await Promise.all([listProducts({ ids, limit: ids.length }), mainMediaIds(ids)]);
  const images = await imagesFor(Object.values(media));
  return rows.map((r) => ({
    productId: r.id,
    slug: r.slug,
    href: `/plant/${r.slug}`,
    name: r.name,
    nameKn: r.nameKn,
    group: r.collectionName ?? '',
    subcategory: r.subcategory,
    sizeClass: r.sizeClass,
    variantId: r.variantId,
    climate: r.climate,
    bearingYearsMin: r.bearingYearsMin,
    yieldText: r.yieldText,
    image: media[r.id] ? (images[media[r.id]!] ?? null) : null,
  }));
}

async function taggedNitrogenFixers(): Promise<ReadonlySet<string>> {
  try {
    return new Set((await listProducts({ kind: 'plant', tagSlug: 'nitrogen-fixing' })).rows.map((r) => r.id));
  } catch {
    return new Set();
  }
}

export function mergeMessages(overrides: Overrides = {}): PlantingMessages {
  const out = { ...plantingMessages } as Record<string, unknown>;
  for (const [k, v] of Object.entries(overrides)) out[k] = { ...(plantingMessages as Record<string, object>)[k], ...v };
  return out as PlantingMessages;
}

function build(input: PlantingRuntimeInput): PlantingRuntime {
  return {
    registry: input.registry ?? null,
    products: input.products ?? catalogFacts,
    places: input.places ?? placesReader,
    pricing: input.pricing === undefined ? pricingReader : input.pricing,
    cart: input.cart ?? null,
    inputs: input.inputs ?? null,
    videos: input.videos ?? null,
    otp: input.otp ?? null,
    nitrogenFixers: input.nitrogenFixers ?? taggedNitrogenFixers,
    productIdsBySku: input.productIdsBySku ?? null,
    messages: mergeMessages(input.messages),
  };
}

const KEY = Symbol.for('ecomkit.planting.runtime');
type Holder = { [KEY]?: PlantingRuntime };

/** Binds the host's capabilities once at boot (replaces any earlier binding). Kept on globalThis for every bundle. */
export function configurePlanting(input: PlantingRuntimeInput): void {
  (globalThis as Holder)[KEY] = build(input);
}

export function plantingRuntime(): PlantingRuntime {
  return ((globalThis as Holder)[KEY] ??= build({}));
}

/** A read that may fail because an optional capability is unconfigured: the page renders without it. */
export async function orElse<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    // Next's control-flow errors (dynamic usage, postpone, notFound) carry a digest and must propagate.
    if (typeof err === 'object' && err !== null && 'digest' in err) throw err;
    return fallback;
  }
}
