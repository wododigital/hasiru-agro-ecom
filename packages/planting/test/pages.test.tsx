import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as Navigation from 'next/navigation';
import type { ReactNode } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('next/navigation', async (original) => ({
  ...(await original<typeof Navigation>()),
  useRouter: () => ({ push() {}, refresh() {}, prefetch() {}, replace() {} }),
  useSearchParams: () => new URLSearchParams('district=mysuru&sqft=87120&purpose=boundary'),
}));

import core, { createRegistry, resolveModules } from '@ecomkit/core/manifest';
import type { ModuleManifest, PlacesReader } from '@ecomkit/core/contracts';
import { createTestDb, fakePricing, type TestDb } from '@ecomkit/core/testing';
import manifest from '../src/manifest';
import { blockLayout, choosePicks, toPicks } from '../src/domain';
import { ModelEditPage, ModelsPage } from '../src/admin';
import ModelPage, { generateStaticParams as modelParams } from '../src/routes/model';
import PlanPage from '../src/routes/plan';
import PlanResultsPage from '../src/routes/plan-results';
import { generateStaticParams as forParams } from '../src/routes/plants-for';
import { configurePlanting, generatePlan, runPlantingSeed, unlockPlan, type PlantFacts } from '../src/server';
import { PlanDiagram } from '../src/ui';
import { commercial } from './fixtures';
import { asGuest, asStaff } from './viewers';

async function renderHtml(node: ReactNode): Promise<string> {
  const { prerenderToNodeStream } = await import('react-dom/static');
  const { prelude } = await prerenderToNodeStream(node, { onError: (err) => void (err as { digest?: string })?.digest });
  let html = '';
  for await (const chunk of prelude) html += chunk;
  return html;
}

const SEED = join(__dirname, '..', '..', '..', 'data', 'seed');
let t: TestDb;
let dir: string;
const ids = new Map<string, string>();
const idFor = (sku: string) => {
  if (!ids.has(sku)) ids.set(sku, `0199f000-0000-7000-8000-${String(ids.size + 1).padStart(12, '0')}`);
  return ids.get(sku)!;
};
const facts = (productId: string): PlantFacts => ({
  productId,
  slug: `plant-${productId.slice(-3)}`,
  href: `/plant/plant-${productId.slice(-3)}`,
  name: `Plant ${productId.slice(-3)}`,
  nameKn: null,
  group: 'Fruiting Trees',
  subcategory: 'Desi',
  sizeClass: 'L',
  variantId: productId.replace(/^0199f000/, 'aaaaaaaa'),
  climate: null,
  bearingYearsMin: 4,
  yieldText: '50 kg',
  image: null,
});
const places: PlacesReader = {
  suggest: async () => [],
  getDistrict: async (slug) => (slug === 'mysuru' ? { slug, name: 'Mysuru', stateCode: 'KA', stateName: 'Karnataka', gstStateCode: '29', distanceKm: 150, lat: null, lng: null } : null),
  fit: async () => ({ level: 'good', reasons: [] }),
};
const visitor = { visitorId: '0199f000-0000-7000-8000-0000000000aa', customerId: null, ip: null };
const params = <T,>(v: T) => Promise.resolve(v);
const noSearch = params({} as Record<string, string>);

beforeAll(async () => {
  process.env.INTERNAL_SECRET = 'q'.repeat(40);
  t = await createTestDb('wp-24-pages', { schemas: ['core', 'customers', 'planting'] });
  dir = mkdtempSync(join(tmpdir(), 'wp24-pages-'));
  const models = JSON.parse(readFileSync(join(SEED, 'models.json'), 'utf8')) as { records: { slug: string }[] };
  writeFileSync(join(dir, 'models.json'), JSON.stringify({ records: models.records.filter((r) => r.slug === 'commercial' || r.slug === 'boundary') }));
  configurePlanting({
    products: async (list) => list.map(facts),
    places,
    pricing: fakePricing(),
    cart: { replacePackage: async () => ({ ok: true }) },
    inputs: null,
    videos: async (slug) => [{ id: 'v1', title: `${slug} layout`, url: 'https://video.example.test/v1' }],
    productIdsBySku: async (skus) => Object.fromEntries(skus.map((s) => [s, idFor(s)])),
    registry: { has: (id) => id === 'planting-3d' || id === 'cart' },
  });
  await runPlantingSeed({ seedDir: dir, mediaDir: dir, dryRun: false, log: { info() {}, warn() {}, error() {} } });
});
afterAll(async () => {
  await t?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('manifest', () => {
  it('resolves with its dependencies and every route module exports what its stub re-exports', async () => {
    const deps = manifest.dependsOn.filter((d) => d !== 'core').map((id): ModuleManifest => ({ id, dependsOn: ['core'] }));
    const ordered = resolveModules([core, ...deps, manifest], ['core', ...deps.map((d) => d.id), manifest.id]);
    expect(ordered.at(-1)!.id).toBe('planting');
    for (const r of [...(manifest.routes ?? []), ...(manifest.admin?.pages ?? [])]) {
      const file = fileURLToPath(new URL(`../src/${r.module}.tsx`, import.meta.url));
      const mod = (await import(/* @vite-ignore */ file)) as Record<string, unknown>;
      for (const name of r.exports) expect(typeof mod[name], `${r.module} ${name}`).toBe('function');
    }
    expect(manifest.admin!.pages!.every((p) => p.path.startsWith('/admin/planting'))).toBe(true);
    expect(createRegistry([core, ...deps, manifest], { mocks: false }).has('planting')).toBe(true);
    expect(Object.keys(await manifest.schema!())).toEqual(expect.arrayContaining(['plantingModel', 'plantingModelPlant', 'plantingPlan']));
    expect(typeof (await manifest.seedHooks![0]!.run())).toBe('function');
    expect(typeof (await manifest.pdpSections![0]!.component())).toBe('function');
    expect(await (await manifest.sitemapSources![0]!.entries())()).toEqual(expect.arrayContaining([{ path: '/models/commercial', changeFrequency: 'monthly' }]));
  });
});

describe('plan diagram', () => {
  it('draws every point of the Commercial block with faint edges, a title, a description and the legend', async () => {
    const picks = toPicks(choosePicks(commercial.members, {}, 3).picks, (id) => `Plant ${id.slice(-2)}`);
    const block = blockLayout(commercial, picks);
    const layout = { ...block, modelSlug: 'commercial', modelName: 'Commercial', blocks: 33.6, totalPlants: 605, boundaryFt: null, legend: (['M', 'X', 'O'] as const).map((role) => ({ role, productIds: picks[role].map((p) => p.productId), perBlock: block.perBlock[role] })) };
    const html = await renderHtml(<PlanDiagram layout={layout} />);
    expect(html.match(/<circle /g)).toHaveLength(28);
    expect(html.match(/class="opacity-40"/g)).toHaveLength(10);
    expect(html).toContain('role="img"');
    expect(html).toContain('<title id="plan-commercial-t">');
    expect(html).toContain('<desc id="plan-commercial-d">');
    expect(html).toContain('data-tip="M: Plant 01 (0, 0 ft)"');
    expect(html).toMatch(/fill-role-main/);
    expect(html).toContain('tabindex="0"');
  });
});

describe('storefront pages', () => {
  it('/plan renders the three steps, the model cards and the prefill from the query', async () => {
    const html = await renderHtml(await PlanPage());
    expect(html).toContain('Your planting plan in 3 steps');
    expect(html).toContain('Commercial');
    expect(html).toContain('Boundary');
    expect(html).toContain('Mysuru');
    expect(html).toMatch(/value="boundary"[^>]*checked|checked[^>]*value="boundary"/);
    expect(html).toContain('data-cta="wizard-generate"');
  });

  it('results: locked plans render blurred without quantities and with the unlock card', async () => {
    asGuest();
    const { planId } = await generatePlan({ district: 'mysuru', sqft: 43_560, purpose: 'commercial' }, visitor);
    const html = await renderHtml(<PlanResultsPage params={params({ planId })} searchParams={noSearch} />);
    expect(html).toContain('Unlock your plan');
    expect(html).toContain('name="phone"');
    expect(html).toMatch(/inert=""/);
    expect(html).not.toContain('data-cta="plan-add-package"');
    expect(html).not.toContain('wa.me');
    expect(html).toMatch(/Mysuru(<!-- -->)?, Karnataka/);
    expect(html).toContain('1 acre<');
    expect(html).toContain('33.6 blocks of 36 x 36 ft');
  });

  it('results: unlocked plans show quantities, the package button, 3D, video, share and build-for-me links', async () => {
    const { planId } = await generatePlan({ district: 'mysuru', sqft: 43_560, purpose: 'commercial' }, visitor);
    await unlockPlan({ step: 'soft', planId, name: 'Asha', phone: '9845012345' }, { ...visitor, requestHeaders: new Headers() });
    const html = await renderHtml(<PlanResultsPage params={params({ planId })} searchParams={noSearch} />);
    expect(html).not.toContain('Unlock your plan');
    expect(html).toContain('data-cta="plan-add-package"');
    expect(html).toContain(`/models/commercial/3d?plan=${planId}`);
    expect(html).toContain('commercial layout');
    expect(html).toContain('https://wa.me/?text=');
    expect(html).toContain('/build-farm-with-us?source=plan');
    expect(html).toMatch(/value="34"/); // first main plant: 101 split over 3 picks
  });

  it('results: an unknown plan is a 404', async () => {
    const html = await renderHtml(<PlanResultsPage params={params({ planId: '0199f000-0000-7000-8000-00000000dead' })} searchParams={noSearch} />);
    expect(html).not.toContain('data-model=');
  });

  it('/models/[model] is static per active model with the pattern and the wizard CTA', async () => {
    expect(await modelParams()).toEqual([{ model: 'commercial' }, { model: 'boundary' }]);
    expect(await forParams()).toEqual([{ model: 'commercial' }, { model: 'boundary' }]);
    const html = await renderHtml(await ModelPage({ params: params({ model: 'boundary' }) }));
    expect(html).toContain('Boundary');
    expect(html).toContain('plants per 36 ft of boundary');
    expect(html).toContain('href="/plan?purpose=boundary"');
    expect(html).toContain('href="/plants/for/boundary"');
    expect(html.match(/<circle /g)).toHaveLength(4);
    await expect(ModelPage({ params: params({ model: 'nope' }) })).rejects.toThrow();
  });
});

describe('admin pages', () => {
  it('lists models for catalog editors and refuses support staff', async () => {
    asStaff('catalog_editor');
    const html = await renderHtml(await ModelsPage({ searchParams: noSearch }));
    expect(html).toContain('Planting models');
    expect(html).toContain('Rows: MOXOXOM');
    expect(html).toContain('Line: MOXO');
    asStaff('support');
    await expect(ModelsPage({ searchParams: noSearch })).rejects.toThrow();
    asGuest();
  });

  it('edit page shows the model form and its members with role, spacing and default pick controls', async () => {
    asStaff('manager');
    const html = await renderHtml(await ModelEditPage({ params: params({ model: 'commercial' }), searchParams: params({ saved: '1' }) }));
    expect(html).toContain('Saved.');
    expect(html).toContain('name="patternKind"');
    expect(html).toContain('MOXOXOM');
    expect(html).toMatch(/Plants in this model \((<!-- -->)?\d+(<!-- -->)?\)/);
    expect(html).toContain('name="isDefaultPick"');
    const fresh = await renderHtml(await ModelEditPage({ params: params({ model: 'new' }), searchParams: noSearch }));
    expect(fresh).toContain('New model');
    await expect(ModelEditPage({ params: params({ model: 'missing' }), searchParams: noSearch })).rejects.toThrow();
    asGuest();
  });
});
