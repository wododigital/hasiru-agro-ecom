import { deriveAvailability, productPath, type AvailabilityOverride, type Status } from '@ecomkit/catalog/domain';
import { facetSource, getProductBySlug, listProducts } from '@ecomkit/catalog/server';
import type { FitLevel, PriceQuote, StockInfo } from '@ecomkit/core/contracts';
import {
  listDecision,
  notesFor,
  parseQuestion,
  qtyForArea,
  rankProducts,
  selectCandidates,
  MAX_PRODUCTS,
  type AssistantMode,
  type CatalogItem,
  type Facts,
  type ParsedQuestion,
  type ProductFact,
  type StockState,
} from '../domain';
import { assistantRuntime, optionalService, type CompanionSource } from './runtime';

/** Every visible product as the rules engine sees it, from catalog's cached public reads (no prices or stock). */
export async function loadCatalogItems(): Promise<CatalogItem[]> {
  const [{ rows }, facets] = await Promise.all([listProducts({ limit: 2000 }), facetSource()]);
  const byId = new Map(facets.map((f) => [f.productId, f.facets]));
  return rows.map((r) => {
    const f = byId.get(r.id);
    return {
      id: r.id,
      slug: r.slug,
      href: productPath(r.kind, r.slug),
      kind: r.kind,
      name: r.name,
      nameKn: r.nameKn,
      groups: [r.collectionName, r.subcategory, ...(f?.collection ?? []), ...(f?.tag ?? [])].filter((g): g is string => !!g),
      collectionLine: [r.collectionName, r.subcategory].filter(Boolean).join(' · ') || null,
      exposure: f?.exposure?.[0] ?? null,
      bearingYearsMin: r.bearingYearsMin,
      bearingYearsMax: r.bearingYearsMax,
      nitrogenFixer: f?.nitrogen_fixer?.[0] === 'yes',
      isBestSeller: r.isBestSeller,
      variantId: r.variantId,
      climate: r.climate,
      status: r.status,
      availabilityOverride: r.availabilityOverride,
    };
  });
}

function stockState(item: CatalogItem, stock: StockInfo | null): StockState | 'hidden' {
  const a = deriveAvailability({ status: item.status as Status, override: item.availabilityOverride as AvailabilityOverride | null, stock });
  if (a === 'temporarily_unavailable') return 'out_of_stock';
  if (a === 'coming_soon') return 'preorder';
  return a;
}

function bulkOf(q: PriceQuote | undefined): ProductFact['bulk'] {
  const t = q?.nextTier ?? (q?.tier && q.tier.minQty > 1 ? q.tier : null);
  return t ? { minQty: t.minQty, unitPaise: t.unitPaise } : null;
}

/** Live price and stock for candidates: one batched call per enabled module (pricing, inventory). */
async function enrich(items: readonly CatalogItem[]): Promise<ProductFact[]> {
  const [pricing, inventory] = await Promise.all([optionalService('pricing'), optionalService('inventory')]);
  const variantIds = [...new Set(items.flatMap((i) => (i.variantId ? [i.variantId] : [])))];
  const [prices, stocks] = await Promise.all([
    pricing && variantIds.length ? pricing.getPrices(variantIds.map((variantId) => ({ variantId, qty: 1 }))) : Promise.resolve({} as Record<string, PriceQuote>),
    inventory && variantIds.length ? inventory.getStocks(variantIds) : Promise.resolve({} as Record<string, StockInfo>),
  ]);
  return items.flatMap((i): ProductFact[] => {
    const quote = i.variantId ? prices[i.variantId] : undefined;
    const stock = stockState(i, i.variantId ? (stocks[i.variantId] ?? null) : null);
    if (stock === 'hidden') return [];
    return [
      {
        id: i.id,
        name: i.name,
        href: i.href,
        variantId: i.variantId,
        collectionLine: i.collectionLine,
        unitPaise: quote?.unitPaise ?? null,
        bulk: bulkOf(quote),
        stock,
        bearingYears: i.bearingYearsMin != null ? { min: i.bearingYearsMin, max: i.bearingYearsMax } : null,
        shade: i.exposure === 'partial_shade' || i.exposure === 'shade',
        nitrogenFixer: i.nitrogenFixer,
        fit: null,
        areaQty: null,
      },
    ];
  });
}

/** Default companions: the catalog's `companion` relations (admin-curated). Planting can replace this source. */
export const catalogCompanions =
  (items: readonly CatalogItem[]): CompanionSource =>
  async (ids) => {
    const slugs = new Map(items.map((i) => [i.id, i.slug]));
    const out: Record<string, string[]> = {};
    await Promise.all(
      ids.map(async (id) => {
        const slug = slugs.get(id);
        const detail = slug ? await getProductBySlug(slug) : null;
        out[id] = detail?.related.filter((r) => r.relation === 'companion').map((r) => r.relatedId) ?? [];
      }),
    );
    return out;
  };

async function resolveDistrict(q: ParsedQuestion, mode: AssistantMode): Promise<{ slug: string; name: string } | null> {
  if (!q.intents.includes('fit') && mode !== 'plan') return null;
  const places = await optionalService('places');
  if (!places) return null;
  if (q.placeQuery) {
    const hit = (await places.suggest(q.placeQuery, 1))[0];
    if (hit) return { slug: hit.district.slug, name: hit.district.name };
  }
  const slug = await assistantRuntime().readDistrict();
  const d = slug ? await places.getDistrict(slug) : null;
  return d ? { slug: d.slug, name: d.name } : null;
}

function spacingOf(spacing: Record<string, [number, number] | number | null>): { value: [number, number] | number; label: string } | null {
  for (const v of Object.values(spacing)) {
    if (Array.isArray(v) && v[0] > 0 && v[1] > 0) return { value: v, label: `${v[0]} x ${v[1]}` };
    if (typeof v === 'number' && v > 0) return { value: v, label: `${v}` };
  }
  return null;
}

/**
 * The rules engine: question -> facts. Retrieval and filters over the catalogue, live price and stock, district
 * fit, companions and area quantities. Nothing here is generated; the narrator only restates the result.
 */
export async function buildFacts(question: string, mode: AssistantMode, items?: readonly CatalogItem[]): Promise<Facts> {
  const rt = assistantRuntime();
  const q = parseQuestion(question, rt.messages.lexicon);
  const catalog = items ?? (await loadCatalogItems());
  const selection = selectCandidates(q, catalog);
  const best = selection.best;
  let candidates = selection.candidates;
  const decision = listDecision(q, best);

  let companionOf: Facts['companionOf'] = null;
  let companionsMissing = false;
  if (decision.list && q.intents.includes('companions') && best > 0 && candidates[0]) {
    const anchor = candidates[0].item;
    const source = rt.companions ?? catalogCompanions(catalog);
    const ids = new Set((await source([anchor.id]))[anchor.id] ?? []);
    const companions = catalog.filter((i) => ids.has(i.id));
    if (companions.length) {
      companionOf = { id: anchor.id, name: anchor.name };
      candidates = companions.map((item) => ({ item, matched: 0, weight: Number(item.isBestSeller) }));
    } else companionsMissing = true;
  }

  let products: ProductFact[] = [];
  const district = decision.list ? await resolveDistrict(q, mode) : null;
  if (decision.list && candidates.length) {
    const weights = new Map(candidates.map((c) => [c.item.id, c.weight]));
    const enriched = await enrich(candidates.map((c) => c.item));
    let ranked = rankProducts({ ...q, intents: q.intents.filter((i) => i !== 'fit') }, enriched, weights, MAX_PRODUCTS * 3);
    if (district) {
      const places = await optionalService('places');
      const climate = new Map(catalog.map((i) => [i.id, i.climate]));
      const fits = await Promise.all(ranked.map(async (p): Promise<FitLevel | null> => (places && climate.get(p.id) ? (await places.fit(district.slug, climate.get(p.id)!)).level : null)));
      ranked = ranked.map((p, i) => ({ ...p, fit: fits[i] ?? null }));
    }
    products = rankProducts(district ? q : { ...q, intents: q.intents.filter((i) => i !== 'fit') }, ranked, weights, MAX_PRODUCTS);
    if (q.acres != null) {
      const slugs = new Map(catalog.map((i) => [i.id, i.slug]));
      products = await Promise.all(
        products.map(async (p) => {
          const detail = await getProductBySlug(slugs.get(p.id)!);
          const sp = detail ? spacingOf(detail.product.spacingFt) : null;
          const qty = sp ? qtyForArea(q.acres!, sp.value) : null;
          return qty ? { ...p, areaQty: { qty, acres: q.acres!, spacing: sp!.label } } : p;
        }),
      );
    }
  }

  return {
    mode,
    question,
    intents: q.intents,
    products,
    notes: notesFor(q, { products: products.length, noMatch: decision.noMatch || (decision.list && !products.length), companionsMissing }),
    district: products.some((p) => p.fit) ? district : null,
    companionOf,
    acres: q.acres,
  };
}

