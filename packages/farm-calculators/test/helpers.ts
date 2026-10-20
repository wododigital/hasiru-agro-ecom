import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importSeed, listProducts } from '@ecomkit/catalog/server';
import { ForbiddenError, setAuthProvider } from '@ecomkit/core/auth-context';
import { ROLE_PERMISSIONS, type AuthContext, type Viewer } from '@ecomkit/core/contracts';
import { createTestDb, type TestDb } from '@ecomkit/core/testing';
import { configurePricing, saveVariantPricing } from '@ecomkit/pricing/server';

/** Own database per test file: ecomkit_wp_25_<suffix>, with the catalog and pricing tables this module reads. */
export async function calcDb(suffix: string): Promise<TestDb> {
  process.env.INTERNAL_SECRET ??= 'i'.repeat(40);
  process.env.SETTINGS_MASTER_KEY ??= `1:${randomBytes(32).toString('base64')}`;
  return createTestDb(`wp-25-${suffix}`, { schemas: ['core', 'catalog', 'pricing', 'farm-calculators'] });
}

const envelope = (records: unknown) => JSON.stringify({ version: 1, generated_at: '2026-10-20T10:00:00+05:30', sources: ['fixture'], records }, null, 2);
const base = { status: 'active', search_aliases: [], tags: [], is_best_seller: false, is_featured: false, needs_review: false, review_notes: [] };
const plant = (sku: string, name: string, size: 'L' | 'M' | 'S', models: Record<string, unknown>, compost: number | null) => ({
  ...base,
  sku,
  kind: 'plant',
  name_en: name,
  slug: name.toLowerCase().replace(/\s+/g, '-'),
  collection: 'fruiting',
  subcategory: 'Desi',
  plant: { size_class: size, canopy: size === 'L' ? 'large_tree' : 'shrub', models, compost_kg: compost === null ? null : { at_planting: compost, y0_2: compost, y3_6: compost * 2, y7_plus: compost * 3 } },
  variants: [{ label: 'Sapling', sku: `${sku}-01`, weight_kg: 2 }],
  tax: { hsn: '0602', gst_rate: 0, tax_class: 'plants_nil' },
});
const input = (sku: string, name: string, pack: number, unit: string, rules: unknown[]) => ({
  ...base,
  sku,
  kind: 'input',
  name_en: name,
  slug: name.toLowerCase().replace(/\s+/g, '-'),
  collection: 'input',
  subcategory: name,
  input: { pack_size: pack, unit, dosage_rules: rules },
  variants: [{ label: `${pack} ${unit}`, sku: `${sku}-01`, weight_kg: pack }],
  tax: { hsn: '3101', gst_rate: 5, tax_class: 'inputs_5' },
});
const perRole = (m: number, x: number, o: number) => [
  { basis: 'per_plant', model: null, role: 'M', size_class: null, qty: m, unit: 'kg' },
  { basis: 'per_plant', model: null, role: 'X', size_class: null, qty: x, unit: 'kg' },
  { basis: 'per_plant', model: null, role: 'O', size_class: null, qty: o, unit: 'kg' },
];

/** Generic catalogue: three plants (one without grid spacing) and five inputs mirroring the plan's dosage table. */
export const fixtureProducts = [
  plant('T-P1', 'Tall Fruit Tree', 'L', { food_forest: { spacing_ft: [18, 18] }, commercial: { spacing_ft: [9, 9] }, boundary: null }, 5),
  plant('T-P2', 'Bush Plant', 'S', { food_forest: { spacing_ft: [6, 6] } }, null),
  plant('T-P3', 'Hedge Plant', 'M', { boundary: { spacing_ft: 10 } }, 2),
];
export const fixtureInputs = [
  input('T-I1', 'Worm Compost', 25, 'kg', perRole(2, 1, 0.5)),
  input('T-I2', 'Charcoal Mix', 10, 'kg', perRole(1, 0.5, 0.25)),
  input('T-I3', 'Seed Cake', 25, 'kg', [{ basis: 'per_plant', role: null, size_class: null, qty: 0.25, unit: 'kg' }]),
  input('T-I4', 'Liquid Feed', 5, 'L', [{ basis: 'per_acre', role: null, size_class: null, qty: 20, unit: 'L' }]),
  input('T-I5', 'Cover Seed', 1, 'kg', [
    { basis: 'per_acre', role: null, size_class: null, qty: 10, unit: 'kg' },
    { basis: 'per_block', role: null, size_class: null, qty: 0.3, unit: 'kg', note: 'derived from per acre' },
  ]),
  input('T-I6', 'Farm Compost', 50, 'kg', [{ basis: 'per_plant', role: null, size_class: null, qty: 1, unit: 'kg', note: "uses each plant's compost_kg.at_planting" }]),
];

export async function seedCatalog(): Promise<{ ids: Record<string, string>; variants: Record<string, string> }> {
  configurePricing({ gstRates: async (ids) => Object.fromEntries(ids.map((id) => [id, 0])), variantsOf: async () => [] });
  const dir = await mkdtemp(join(tmpdir(), 'farmcalc-seed-'));
  await writeFile(join(dir, 'products.json'), envelope(fixtureProducts));
  await writeFile(join(dir, 'inputs.json'), envelope(fixtureInputs));
  await importSeed({ seedDir: dir });
  const { rows } = await listProducts({ limit: 100 });
  const ids = Object.fromEntries(rows.map((r) => [r.name, r.id]));
  const variants = Object.fromEntries(rows.map((r) => [r.name, r.variantId!]));
  return { ids, variants };
}

export async function setPrice(productId: string, variantId: string, pricePaise: number, tiers: { minQty: number; unitPaise: number }[] = []): Promise<void> {
  await saveVariantPricing({ productId, variantId, pricePaise, compareAtPaise: null, offlinePricePaise: null, costPaise: null, tiers }, { actorId: null });
}

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

export const MANAGER: Viewer = { kind: 'staff', userId: '00000000-0000-7000-8000-00000000aaaa', name: 'Manager', email: 'm@example.test', role: 'manager', permissions: ROLE_PERMISSIONS.manager };
export const SUPPORT: Viewer = { kind: 'staff', userId: '00000000-0000-7000-8000-00000000bbbb', name: 'Support', email: 's@example.test', role: 'support', permissions: ROLE_PERMISSIONS.support };

/** Renders a React tree (async server components included) to HTML, waiting for every Suspense boundary. */
export async function renderHtml(node: React.ReactNode): Promise<string> {
  const { prerenderToNodeStream } = await import('react-dom/static');
  const { prelude } = await prerenderToNodeStream(node, { onError: (err) => void (err as { digest?: string })?.digest });
  let html = '';
  for await (const chunk of prelude) html += chunk;
  return html;
}
