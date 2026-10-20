// Generic test catalogue (no store names) in the data/seed product shape the catalog importer reads.
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AuthContext, ModuleId, PricingReader, PriceQuote, ServiceKey, ServiceMap, StaffViewer, Viewer, Paise } from '@ecomkit/core/contracts';
import { ROLE_PERMISSIONS } from '@ecomkit/core/contracts';
import { ForbiddenError, setAuthProvider } from '@ecomkit/core/auth-context';

const plant = (o: Record<string, unknown> & { sku: string; name_en: string; slug: string }) => ({
  status: 'active',
  kind: 'plant',
  search_aliases: [],
  tags: [],
  is_best_seller: false,
  is_featured: false,
  provenance: { identity: 'client' },
  needs_review: false,
  review_notes: [],
  variants: [{ label: 'Sapling', weight_kg: 2 }],
  ...o,
});

const climate = (exposure: string) => ({ temp_c: { opt: 27, min: 15, max: 38 }, rainfall_mm: { min: 600, max: 2500 }, exposure, soil_tags: [] });

export const products = [
  plant({
    sku: 'T-001',
    name_en: 'Alpha Mango',
    base_name: 'Mango',
    slug: 'alpha-mango',
    collection: 'fruiting',
    subcategory: 'Desi',
    is_best_seller: true,
    plant: { size_class: 'L', nitrogen_fixer: false, climate: climate('full_sun'), models: { food_forest: { spacing_ft: [18, 18], role: 'M' } }, attributes: { bearing_years: '3-4' } },
  }),
  plant({
    sku: 'T-002',
    name_en: 'Beta Guava',
    base_name: 'Guava',
    slug: 'beta-guava',
    collection: 'fruiting',
    subcategory: 'Exotic',
    plant: { size_class: 'M', nitrogen_fixer: false, climate: climate('partial_shade'), models: { food_forest: { spacing_ft: [10, 10], role: 'X' } }, attributes: { bearing_years: '2-3' } },
  }),
  plant({
    sku: 'T-003',
    name_en: 'Teak',
    slug: 'teak',
    collection: 'timber',
    subcategory: 'Timber',
    plant: { size_class: 'L', nitrogen_fixer: false, climate: climate('full_sun'), models: { commercial: { spacing_ft: [9, 9] } }, attributes: { timber_rotation_years: '20-25' } },
  }),
  plant({
    sku: 'T-004',
    name_en: 'Gamma Coffee',
    slug: 'gamma-coffee',
    collection: 'other',
    subcategory: 'Plantation',
    plant: { size_class: 'S', nitrogen_fixer: false, climate: climate('shade'), models: {} },
  }),
  plant({
    sku: 'T-005',
    name_en: 'Delta Gliricidia',
    slug: 'delta-gliricidia',
    collection: 'other',
    subcategory: 'Biomass support',
    plant: { size_class: 'M', nitrogen_fixer: true, climate: climate('full_sun'), models: {} },
  }),
];

/** List price in rupees and one bulk tier per slug. */
export const PRICES: Record<string, { list: number; tier: { minQty: number; unit: number } | null }> = {
  'alpha-mango': { list: 450, tier: { minQty: 50, unit: 355 } },
  'beta-guava': { list: 320, tier: null },
  teak: { list: 120, tier: { minQty: 100, unit: 90 } },
  'gamma-coffee': { list: 60, tier: null },
  'delta-gliricidia': { list: 40, tier: null },
};

export async function writeSeedDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'assistant-seed-'));
  await writeFile(join(dir, 'products.json'), JSON.stringify({ version: 1, generated_at: '2026-10-20T10:00:00+05:30', sources: ['fixture'], records: products }));
  return dir;
}

/** Pricing reader over PRICES keyed by variant id. */
export function pricingFor(variantSlug: ReadonlyMap<string, string>): PricingReader {
  const quote = (variantId: string, qty: number): PriceQuote | null => {
    const p = PRICES[variantSlug.get(variantId) ?? ''];
    if (!p) return null;
    const inTier = !!p.tier && qty >= p.tier.minQty;
    const unit = (inTier ? p.tier!.unit : p.list) * 100;
    return {
      productId: variantId,
      variantId,
      qty,
      listUnitPaise: (p.list * 100) as Paise,
      compareAtPaise: null,
      unitPaise: unit as Paise,
      tier: inTier ? { minQty: p.tier!.minQty, unitPaise: (p.tier!.unit * 100) as Paise } : null,
      nextTier: p.tier && !inTier ? { minQty: p.tier.minQty, unitPaise: (p.tier.unit * 100) as Paise, qtyToGo: p.tier.minQty - qty } : null,
      gstRatePct: 0,
      lineTotalPaise: (unit * qty) as Paise,
    };
  };
  return {
    getPrice: async (v, q) => quote(v, q),
    getPrices: async (items) => Object.fromEntries(items.flatMap((i) => (quote(i.variantId, i.qty) ? [[i.variantId, quote(i.variantId, i.qty)!]] : []))),
  };
}

export function fakeRegistry(o: { modules?: ModuleId[]; services?: Partial<ServiceMap> } = {}) {
  const mods = new Set(o.modules ?? []);
  return {
    has: (id: ModuleId) => mods.has(id),
    service: async <K extends ServiceKey>(key: K) => (o.services?.[key] ?? null) as ServiceMap[K] | null,
    list: (() => []) as never,
  };
}

export const MANAGER: StaffViewer = { kind: 'staff', userId: '00000000-0000-7000-8000-00000000bbbb', name: 'Manager', email: 'manager@example.test', role: 'manager', permissions: ROLE_PERMISSIONS.manager };

export function signInAs(viewer: Viewer): void {
  const auth: AuthContext = {
    getViewer: async () => viewer,
    requirePermission: async (perm) => {
      if (viewer.kind !== 'staff' || !viewer.permissions.includes(perm)) throw new ForbiddenError();
      return viewer;
    },
    requireOwner: async () => {
      throw new ForbiddenError();
    },
  };
  setAuthProvider(async () => auth);
}

/** Renders a React tree (async server components included) to HTML. */
export async function renderHtml(node: React.ReactNode): Promise<string> {
  const { prerenderToNodeStream } = await import('react-dom/static');
  const { prelude } = await prerenderToNodeStream(node, { onError: (err) => void (err as { digest?: string })?.digest });
  let html = '';
  for await (const chunk of prelude) html += chunk;
  return html;
}
