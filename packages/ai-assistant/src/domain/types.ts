import type { ClimateFit, FitLevel, PlantClimate } from '@ecomkit/core/contracts';

export const MODES = ['shop', 'plan', 'farm'] as const;
export type AssistantMode = (typeof MODES)[number];

export const INTENTS = ['bulk', 'delivery', 'returns', 'shade', 'stock', 'companions', 'fit', 'greeting', 'nitrogen', 'bearing', 'price', 'acreage', 'offTopic'] as const;
export type Intent = (typeof INTENTS)[number];

/** One catalogue row as the rules engine sees it (from catalog's public reads; no prices or stock yet). */
export interface CatalogItem {
  id: string;
  slug: string;
  href: string;
  kind: string;
  name: string;
  nameKn: string | null;
  /** Collection, parent collection, subcategory and tag names/slugs: what category words match against. */
  groups: readonly string[];
  collectionLine: string | null;
  exposure: string | null;
  bearingYearsMin: number | null;
  bearingYearsMax: number | null;
  nitrogenFixer: boolean;
  isBestSeller: boolean;
  variantId: string | null;
  climate: PlantClimate | null;
  /** Catalog availability before stock: `hidden` rows never reach the engine. */
  status: string;
  availabilityOverride: string | null;
}

export type StockState = 'in_stock' | 'low_stock' | 'preorder' | 'out_of_stock' | 'unknown';

/** A product in an answer, with every number the narration may quote. */
export interface ProductFact {
  id: string;
  name: string;
  href: string;
  variantId: string | null;
  collectionLine: string | null;
  unitPaise: number | null;
  bulk: { minQty: number; unitPaise: number } | null;
  stock: StockState;
  bearingYears: { min: number; max: number | null } | null;
  shade: boolean;
  nitrogenFixer: boolean;
  fit: FitLevel | null;
  /** For area questions when spacing is known: suggested quantity. */
  areaQty: { qty: number; acres: number; spacing: string } | null;
}

export type NoteKey = 'bulk' | 'delivery' | 'returns' | 'noMatch' | 'offTopic' | 'greeting' | 'acreage' | 'companionsUnavailable';

/** What the rules engine decided. The narration may only restate these. */
export interface Facts {
  mode: AssistantMode;
  question: string;
  intents: readonly Intent[];
  products: readonly ProductFact[];
  notes: readonly NoteKey[];
  district: { slug: string; name: string } | null;
  companionOf: { id: string; name: string } | null;
  acres: number | null;
}

export type { ClimateFit, FitLevel, PlantClimate };
