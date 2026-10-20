import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { listAudit } from '@ecomkit/core/audit';
import { ForbiddenError } from '@ecomkit/core/auth-context';
import type { CartLineOrigin, DistrictRef, PlacesReader, PlantClimate } from '@ecomkit/core/contracts';
import { setSettings } from '@ecomkit/core/settings';
import { createTestDb, fakePricing, queuedJobs, type TestDb } from '@ecomkit/core/testing';
import { customersLead } from '@ecomkit/customers/schema';
import { plantingModel, plantingModelPlant, plantingPlan } from '../src/schema';
import {
  addPackage,
  companionIds,
  configurePlanting,
  generatePlan,
  getPlan,
  handleGenerate,
  handleUnlock,
  inputsFor,
  loadModel,
  loadModels,
  modelLayout,
  planView,
  plantingSettings,
  PlanInputError,
  removeMember,
  runPlantingSeed,
  saveMember,
  saveModel,
  unlockPlan,
  type PlantFacts,
} from '../src/server';
import { asCustomer, asGuest, asStaff } from './viewers';

const SEED = join(__dirname, '..', '..', '..', 'data', 'seed');
const ACRE = 43_560;
let t: TestDb;
let dir: string;
const log = { info: () => undefined, warn: () => undefined, error: () => undefined };
const ctx = (dryRun = false) => ({ seedDir: dir, mediaDir: dir, dryRun, log });

// sku -> product id; every third plant needs a wet district (rainfall from 2000 mm).
const skus = (JSON.parse(readFileSync(join(SEED, 'models.json'), 'utf8')) as { records: { members: { sku: string }[] }[] }).records.flatMap((r) => r.members.map((m) => m.sku));
const uniqueSkus = [...new Set(skus)].sort();
const idOf = (i: number) => `0199f000-0000-7000-8000-${String(i + 1).padStart(12, '0')}`;
const productIds: Record<string, string> = Object.fromEntries(uniqueSkus.map((s, i) => [s, idOf(i)]));
const variantOf = (productId: string) => productId.replace(/^0199f000/, 'aaaaaaaa');
const wetOnly = (productId: string) => Number(productId.slice(-4)) % 3 === 0;
const HIDDEN = idOf(0); // not visible in the catalog (draft): must never be recommended

const climate = (wet: boolean): PlantClimate => ({ tempC: { min: 10, max: 40, opt: 28 }, rainfallMm: { min: wet ? 2000 : 400, max: 4000 }, humidityPct: null, soilTags: [] });
const facts = (productId: string): PlantFacts => ({
  productId,
  slug: `plant-${productId.slice(-4)}`,
  href: `/plant/plant-${productId.slice(-4)}`,
  name: `Plant ${productId.slice(-4)}`,
  nameKn: null,
  group: Number(productId.slice(-4)) % 2 ? 'Fruiting Trees' : 'Timber Trees',
  subcategory: null,
  sizeClass: 'M',
  variantId: variantOf(productId),
  climate: climate(wetOnly(productId)),
  bearingYearsMin: 3,
  yieldText: null,
  image: null,
});

const DISTRICTS: Record<string, { ref: DistrictRef; rain: number }> = {
  wetland: { ref: { slug: 'wetland', name: 'Wetland', stateCode: 'KA', stateName: 'Karnataka', gstStateCode: '29', distanceKm: 40, lat: null, lng: null }, rain: 2500 },
  dryland: { ref: { slug: 'dryland', name: 'Dryland', stateCode: 'KA', stateName: 'Karnataka', gstStateCode: '29', distanceKm: 300, lat: null, lng: null }, rain: 600 },
};
const places: PlacesReader = {
  suggest: async () => [],
  getDistrict: async (slug) => DISTRICTS[slug]?.ref ?? null,
  fit: async (slug, c) => ({ level: c.rainfallMm && c.rainfallMm.min > (DISTRICTS[slug]?.rain ?? 0) ? 'not_recommended' : 'good', reasons: [] }),
};

const cartCalls: { packageKey: string; label: string; lines: readonly { productId: string; variantId: string; qty: number; origin: CartLineOrigin }[] }[] = [];
const INPUT = { productId: '0199f000-0000-7000-8000-900000000001', variantId: 'aaaaaaaa-0000-7000-8000-900000000001', name: 'Compost', packLabel: '25 kg', unitPaise: 50_000 };
const otpSent: string[] = [];
const ports = {
  products: async (ids: readonly string[]) => ids.filter((id) => id !== HIDDEN && Object.values(productIds).includes(id)).map(facts),
  places,
  pricing: fakePricing(),
  cart: { replacePackage: async (input: (typeof cartCalls)[number]) => (cartCalls.push(input), { ok: true }) },
  inputs: { recommend: async ({ lines }: { lines: readonly { qty: number }[] }) => [{ ...INPUT, qty: Math.ceil(lines.reduce((s, l) => s + l.qty, 0) / 100) }] },
  otp: {
    send: async ({ identifier }: { identifier: string }) => (otpSent.push(identifier), { status: 'sent' }),
    verify: async ({ code }: { code: string }) =>
      code === '123456' ? { status: 'ok' as const, userId: '0199f000-0000-7000-8000-00000000c0de', headers: new Headers({ 'set-cookie': 'session=abc; Path=/; HttpOnly' }) } : { status: 'invalid' },
  },
  nitrogenFixers: async () => new Set<string>(),
  productIdsBySku: async (list: readonly string[]) => Object.fromEntries(list.filter((s) => productIds[s]).map((s) => [s, productIds[s]!])),
  registry: { has: (id: string) => id === 'planting-3d' },
};

const visitor = { visitorId: '0199f000-0000-7000-8000-0000000000aa', customerId: null, ip: '203.0.113.9' };
const eventsNamed = async (name: string) =>
  (await queuedJobs(t.db, 'core.event')).filter((j) => (j.data as { event: string }).event === name).map((j) => (j.data as { payload: Record<string, unknown> }).payload);
const req = (url: string, init: { body: string; json?: boolean; site?: string; cookie?: string }) =>
  new Request(`http://shop.test${url}`, {
    method: 'POST',
    body: init.body,
    headers: {
      'content-type': init.json === false ? 'application/x-www-form-urlencoded' : 'application/json',
      'sec-fetch-site': init.site ?? 'same-origin',
      'x-real-ip': '198.51.100.7',
      ...(init.cookie ? { cookie: init.cookie } : {}),
    },
  });

beforeAll(async () => {
  process.env.INTERNAL_SECRET = 'p'.repeat(40);
  t = await createTestDb('wp-24', { schemas: ['core', 'customers', 'planting'] });
  dir = mkdtempSync(join(tmpdir(), 'wp24-seed-'));
  cpSync(join(SEED, 'models.json'), join(dir, 'models.json'));
  cpSync(join(SEED, 'products.json'), join(dir, 'products.json'));
  configurePlanting(ports);
});
afterAll(async () => {
  await t?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  await t.db.execute(sql`delete from core_rate_limit`);
});

describe('seed hook', () => {
  it('dry run counts and writes nothing', async () => {
    const r = await runPlantingSeed(ctx(true));
    expect(r.inserted).toBeGreaterThan(300);
    expect(await t.db.select().from(plantingModel)).toHaveLength(0);
  });

  it('creates the four models with members, roles, default picks and per-model spacing', async () => {
    const r = await runPlantingSeed(ctx());
    expect(r.inserted).toBe(4 + skus.length);
    const models = await loadModels();
    expect(models.map((m) => m.slug)).toEqual(['commercial', 'food-forest', 'miyawaki', 'boundary']);
    const commercial = models[0]!;
    expect(commercial.pattern).toEqual({ kind: 'rows', rows: ['MOXOXOM'] });
    expect(commercial.spacingFt).toEqual({ plant: 6, row: 12 });
    expect(models[2]!.pattern).toEqual({ kind: 'random', mix: { M: 0.1, X: 0.5, O: 0.4 }, seed: 42 });
    expect(models[2]!.weightOverrideKg).toBe(0.8);
    expect(models[3]!.pattern).toEqual({ kind: 'line', rows: ['MOXO'] });
    expect(models[3]!.blockFt).toEqual({ w: 36, h: 0 });
    for (const role of ['M', 'X', 'O'] as const) expect(commercial.members.filter((m) => m.role === role && m.isDefaultPick)).toHaveLength(3);
    expect(commercial.members.find((m) => m.productId === productIds['HAP-0001'])?.spacingFt).toEqual([18, 18]);
  });

  it('a second run changes nothing and staff edits survive', async () => {
    await t.db.update(plantingModel).set({ name: 'Orchard' }).where(eq(plantingModel.slug, 'commercial'));
    const r = await runPlantingSeed(ctx());
    expect({ inserted: r.inserted, updated: r.updated, skipped: r.skipped }).toEqual({ inserted: 0, updated: 0, skipped: 4 });
    expect((await loadModel('commercial'))!.name).toBe('Orchard');
    await t.db.update(plantingModel).set({ name: 'Commercial' }).where(eq(plantingModel.slug, 'commercial'));
  });
});

describe('generation', () => {
  it('computes every active model, emits plan.generated and never recommends a hidden product', async () => {
    const { planId } = await generatePlan({ district: 'wetland', sqft: ACRE, purpose: 'commercial' }, visitor);
    const plan = (await getPlan(planId))!;
    expect(Object.keys(plan.selections).sort()).toEqual(['boundary', 'commercial', 'food-forest', 'miyawaki']);
    const c = plan.selections.commercial!;
    expect(c.blocks).toBeCloseTo(33.61, 2);
    expect(c.totalPlants).toBe(101 + 202 + 303);
    expect(c.lines.filter((l) => l.role === 'M').map((l) => l.qty)).toEqual([34, 34, 33]);
    expect(Object.values(plan.selections).flatMap((s) => s.lines.map((l) => l.productId))).not.toContain(HIDDEN);
    expect(plan.unlockedAt).toBeNull();
    expect(plan.boundaryEstimated).toBe(true);
    expect(await eventsNamed('plan.generated')).toContainEqual({ planId, modelSlug: 'commercial' });
  });

  it('Boundary: 835 ft at 10 ft is 84 plants', async () => {
    const { planId } = await generatePlan({ district: 'wetland', sqft: ACRE, boundaryFt: 835, purpose: 'boundary' }, visitor);
    const plan = (await getPlan(planId))!;
    expect(plan.selections.boundary!.totalPlants).toBe(84);
    expect(plan.boundaryEstimated).toBe(false);
  });

  it('location changes the plant set: a dry district drops plants that need more rain', async () => {
    const wet = (await getPlan((await generatePlan({ district: 'wetland', sqft: ACRE, purpose: 'commercial' }, visitor)).planId))!;
    const dry = (await getPlan((await generatePlan({ district: 'dryland', sqft: ACRE, purpose: 'commercial' }, visitor)).planId))!;
    const ids = (p: typeof wet) => new Set(p.selections.commercial!.lines.map((l) => l.productId));
    expect([...ids(wet)].some(wetOnly)).toBe(true);
    expect([...ids(dry)].some(wetOnly)).toBe(false);
    expect(ids(dry)).not.toEqual(ids(wet));
    expect(dry.climateFit).toMatchObject(Object.fromEntries([...ids(wet)].filter(wetOnly).map((id) => [id, 'not_recommended'])));
  });

  it('Miyawaki drawings are seeded by the plan id: stable for a plan, different across plans', async () => {
    const a = await generatePlan({ district: 'wetland', sqft: ACRE, purpose: 'miyawaki' }, visitor);
    const b = await generatePlan({ district: 'wetland', sqft: ACRE, purpose: 'miyawaki' }, visitor);
    const roles = async (id: string) => (await planView(id))!.models[0]!.layout.points.map((p) => p.role).join('');
    expect(await roles(a.planId)).toBe(await roles(a.planId));
    expect(await roles(a.planId)).not.toBe(await roles(b.planId));
  });

  it('rejects an unknown district, an unknown purpose and too little land', async () => {
    await expect(generatePlan({ district: 'atlantis', sqft: ACRE, purpose: 'commercial' }, visitor)).rejects.toMatchObject({ field: 'district' });
    await expect(generatePlan({ district: 'wetland', sqft: ACRE, purpose: 'rice' }, visitor)).rejects.toMatchObject({ field: 'purpose' });
    await expect(generatePlan({ district: 'wetland', sqft: 50, purpose: 'commercial' }, visitor)).rejects.toBeInstanceOf(PlanInputError);
  });
});

describe('results view and unlock', () => {
  it('a locked plan carries no quantities, prices or inputs; the chosen purpose comes first', async () => {
    const { planId } = await generatePlan({ district: 'wetland', sqft: ACRE, purpose: 'food-forest' }, visitor);
    const v = (await planView(planId))!;
    expect(v.unlocked).toBe(false);
    expect(v.models[0]!.slug).toBe('food-forest');
    expect(v.models.flatMap((m) => m.lines).every((l) => l.recommendedQty === null && l.price === null)).toBe(true);
    expect(v.models.every((m) => m.totalPlants === null && m.inputs.length === 0)).toBe(true);
    expect(v.has3d).toBe(true);
    expect(v.buildForMeHref).toMatch(/^\/build-farm-with-us\?source=plan&plan=/);
  });

  it('soft unlock (default): creates an unverified wizard lead, unlocks, emits events and signs nobody in', async () => {
    const { planId } = await generatePlan({ district: 'wetland', sqft: ACRE, purpose: 'commercial' }, visitor);
    const r = await unlockPlan({ step: 'soft', planId, name: 'Asha', phone: '98450 12345' }, { ip: '203.0.113.9', requestHeaders: new Headers() });
    expect(r).toEqual({ status: 'unlocked' });
    const plan = (await getPlan(planId))!;
    expect(plan.unlockedAt).not.toBeNull();
    expect(plan.unlockMode).toBe('soft');
    expect(plan.customerId).toBeNull();
    const [lead] = await t.db.select().from(customersLead).where(eq(customersLead.id, plan.leadId!));
    expect(lead).toMatchObject({ source: 'wizard', phoneVerified: false, userId: null });
    expect(await eventsNamed('lead.created')).toContainEqual({ leadId: plan.leadId, source: 'wizard' });
    expect(await eventsNamed('plan.unlocked')).toContainEqual({ planId, leadId: plan.leadId, mode: 'soft' });
    // Unlocking again from the same phone updates the same lead (customers dedupes on plan ref).
    await unlockPlan({ step: 'soft', planId, name: 'Asha', phone: '+919845012345' }, { ip: '203.0.113.9', requestHeaders: new Headers() });
    expect((await getPlan(planId))!.leadId).toBe(plan.leadId);
    // Unlocked: quantities, prices and inputs are present.
    const v = (await planView(planId))!;
    const first = v.models[0]!;
    expect(first.lines.every((l) => (l.recommendedQty ?? 0) > 0 && l.price !== null)).toBe(true);
    expect(first.totalPlants).toBe(606);
    expect(first.inputs[0]).toMatchObject({ variantId: INPUT.variantId, qty: 7 });
    expect(first.alternates.length).toBeGreaterThan(0);
    expect(first.alternates.every((a) => a.recommendedQty === 0)).toBe(true);
  });

  it('rejects a bad phone and the otp steps while in soft mode', async () => {
    const { planId } = await generatePlan({ district: 'wetland', sqft: ACRE, purpose: 'commercial' }, visitor);
    expect((await unlockPlan({ step: 'soft', planId, name: 'A', phone: '12345' }, { ip: null, requestHeaders: new Headers() })).status).toBe('invalid');
    expect((await unlockPlan({ step: 'send', planId, name: 'A', phone: '9845012345' }, { ip: null, requestHeaders: new Headers() })).status).toBe('wrong_mode');
    expect((await unlockPlan({ step: 'soft', planId: '0199f000-0000-7000-8000-00000000ffff', name: 'A', phone: '9845012345' }, { ip: null, requestHeaders: new Headers() })).status).toBe('not_found');
  });

  it('limits unlock attempts per phone', async () => {
    const { planId } = await generatePlan({ district: 'wetland', sqft: ACRE, purpose: 'commercial' }, visitor);
    const statuses: string[] = [];
    for (let i = 0; i < 9; i++) statuses.push((await unlockPlan({ step: 'soft', planId, name: 'A', phone: '9845099999' }, { ip: `198.51.100.${i}`, requestHeaders: new Headers() })).status);
    expect(statuses.slice(0, 8).every((s) => s === 'unlocked')).toBe(true);
    expect(statuses[8]).toBe('limited');
  });

  it('otp mode: sends a code, rejects a wrong one, and a good one makes a verified lead, signs in and unlocks', async () => {
    await setSettings(plantingSettings, { unlock_mode: 'otp' }, { actorId: null, actorType: 'system' });
    try {
      const { planId } = await generatePlan({ district: 'wetland', sqft: ACRE, purpose: 'commercial' }, visitor);
      const base = { planId, name: 'Ravi', phone: '9876543210' };
      const h = { ip: '203.0.113.9', requestHeaders: new Headers() };
      expect((await unlockPlan({ step: 'soft', ...base }, h)).status).toBe('wrong_mode');
      expect((await unlockPlan({ step: 'send', ...base }, h)).status).toBe('sent');
      expect(otpSent).toContain('+919876543210');
      expect((await unlockPlan({ step: 'verify', ...base, code: '000000' }, h)).status).toBe('code_invalid');
      expect((await getPlan(planId))!.unlockedAt).toBeNull();
      const ok = await unlockPlan({ step: 'verify', ...base, code: '123456' }, h);
      expect(ok.status).toBe('unlocked');
      expect(ok.headers?.getSetCookie()).toEqual(['session=abc; Path=/; HttpOnly']);
      const plan = (await getPlan(planId))!;
      expect(plan).toMatchObject({ unlockMode: 'otp', customerId: '0199f000-0000-7000-8000-00000000c0de' });
      const [lead] = await t.db.select().from(customersLead).where(eq(customersLead.id, plan.leadId!));
      expect(lead).toMatchObject({ phoneVerified: true, userId: '0199f000-0000-7000-8000-00000000c0de' });
    } finally {
      await setSettings(plantingSettings, { unlock_mode: 'soft' }, { actorId: null, actorType: 'system' });
    }
  });
});

describe('package to cart and inputs', () => {
  const unlocked = async (purpose: string) => {
    const { planId } = await generatePlan({ district: 'wetland', sqft: ACRE, purpose }, visitor);
    await unlockPlan({ step: 'soft', planId, name: 'Asha', phone: '9845012345' }, { ip: null, requestHeaders: new Headers() });
    return { planId, plan: (await getPlan(planId))! };
  };

  it('a locked plan cannot be added', async () => {
    const { planId } = await generatePlan({ district: 'wetland', sqft: ACRE, purpose: 'commercial' }, visitor);
    const plan = (await getPlan(planId))!;
    expect(await addPackage({ planId, model: 'commercial', lines: plan.selections.commercial!.lines })).toEqual({ status: 'locked' });
  });

  it('replaces the planting package with edited quantities and included inputs', async () => {
    const { planId, plan } = await unlocked('commercial');
    const lines = plan.selections.commercial!.lines.map((l, i) => ({ productId: l.productId, qty: i === 0 ? l.qty + 5 : l.qty }));
    cartCalls.length = 0;
    expect(await addPackage({ planId, model: 'commercial', lines, inputs: [{ variantId: INPUT.variantId, qty: 9 }] })).toEqual({ status: 'added' });
    const call = cartCalls[0]!;
    expect(call.packageKey).toBe('planting');
    expect(call.label).toBe('Commercial');
    expect(call.lines[0]).toMatchObject({ qty: lines[0]!.qty, variantId: variantOf(lines[0]!.productId), origin: { source: 'planting', modelSlug: 'commercial' } });
    expect(call.lines[0]!.origin.weightKg).toBeUndefined();
    expect(call.lines.at(-1)).toMatchObject({ productId: INPUT.productId, qty: 9 });
  });

  it('Miyawaki lines carry the 0.8 kg weight override', async () => {
    const { planId, plan } = await unlocked('miyawaki');
    cartCalls.length = 0;
    await addPackage({ planId, model: 'miyawaki', lines: plan.selections.miyawaki!.lines });
    expect(cartCalls[0]!.lines.every((l) => l.origin.weightKg === 0.8)).toBe(true);
  });

  it('refuses products outside the model and inputs the engine did not recommend', async () => {
    const { planId, plan } = await unlocked('commercial');
    const lines = plan.selections.commercial!.lines;
    expect(await addPackage({ planId, model: 'commercial', lines: [...lines, { productId: '0199f000-0000-7000-8000-00000000beef', qty: 3 }] })).toEqual({ status: 'invalid' });
    expect(await addPackage({ planId, model: 'commercial', lines, inputs: [{ variantId: 'aaaaaaaa-0000-7000-8000-00000000beef', qty: 1 }] })).toEqual({ status: 'invalid' });
    expect(await addPackage({ planId, model: 'nope', lines })).toEqual({ status: 'not_found' });
  });

  it('inputs follow edited plant quantities', async () => {
    const { planId, plan } = await unlocked('commercial');
    const lines = plan.selections.commercial!.lines.map((l) => ({ productId: l.productId, qty: l.qty * 2 }));
    expect((await inputsFor({ planId, model: 'commercial', lines }))[0]!.qty).toBe(Math.ceil((606 * 2) / 100));
  });

  it('without a cart binding the package button reports the cart as unavailable', async () => {
    const { planId, plan } = await unlocked('commercial');
    configurePlanting({ ...ports, cart: null });
    try {
      expect(await addPackage({ planId, model: 'commercial', lines: plan.selections.commercial!.lines })).toEqual({ status: 'cart_unavailable' });
      expect((await planView(planId))!.cartEnabled).toBe(false);
    } finally {
      configurePlanting(ports);
    }
  });
});

describe('route handlers', () => {
  it('generate refuses cross-site posts', async () => {
    const res = await handleGenerate(req('/api/plan/generate', { body: JSON.stringify({ district: 'wetland', sqft: ACRE, purpose: 'commercial' }), site: 'cross-site' }));
    expect(res.status).toBe(403);
  });

  it('generate works as JSON and as a plain form post (303), setting the visitor and district cookies', async () => {
    asGuest();
    const j = await handleGenerate(req('/api/plan/generate', { body: JSON.stringify({ district: 'wetland', sqft: ACRE, purpose: 'commercial' }) }));
    expect(j.status).toBe(200);
    const { planId, url } = (await j.json()) as { planId: string; url: string };
    expect(url).toBe(`/plan/results/${planId}`);
    const cookies = j.headers.getSetCookie();
    expect(cookies.some((c) => /^plan_visitor=[0-9a-f-]{36}; .*HttpOnly/.test(c))).toBe(true);
    expect(cookies.some((c) => c.startsWith('district=wetland;'))).toBe(true);

    const f = await handleGenerate(req('/api/plan/generate', { body: 'district=dryland&sqft=87120&purpose=boundary&boundaryFt=', json: false, cookie: 'plan_visitor=0199f000-0000-7000-8000-0000000000bb' }));
    expect(f.status).toBe(303);
    const loc = new URL(f.headers.get('location')!);
    expect(loc.pathname).toMatch(/^\/plan\/results\/[0-9a-f-]{36}$/);
    const plan = (await getPlan(loc.pathname.split('/').pop()!))!;
    expect(plan.visitorId).toBe('0199f000-0000-7000-8000-0000000000bb');
    expect(plan.sqft).toBe(87120);

    const bad = await handleGenerate(req('/api/plan/generate', { body: 'district=atlantis&sqft=43560&purpose=commercial', json: false }));
    expect(new URL(bad.headers.get('location')!).search).toBe('?error=district');
  });

  it('generate stores the signed-in customer on the plan', async () => {
    const me = asCustomer();
    const res = await handleGenerate(req('/api/plan/generate', { body: JSON.stringify({ district: 'wetland', sqft: ACRE, purpose: 'commercial' }) }));
    const { planId } = (await res.json()) as { planId: string };
    expect((await getPlan(planId))!.customerId).toBe(me.customerId);
    asGuest();
  });

  it('unlock handler: JSON answers the status, a form post redirects back to the plan', async () => {
    const { planId } = await generatePlan({ district: 'wetland', sqft: ACRE, purpose: 'commercial' }, visitor);
    const bad = await handleUnlock(req('/api/plan/unlock', { body: JSON.stringify({ step: 'soft', planId, name: 'A', phone: '1' }) }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ status: 'invalid' });
    const f = await handleUnlock(req('/api/plan/unlock', { body: new URLSearchParams({ step: 'soft', planId, name: 'Asha', phone: '9845012345' }).toString(), json: false }));
    expect(f.status).toBe(303);
    expect(new URL(f.headers.get('location')!).pathname).toBe(`/plan/results/${planId}`);
    expect(f.headers.getSetCookie()).toEqual([]);
    expect((await getPlan(planId))!.unlockedAt).not.toBeNull();
    expect((await handleUnlock(req('/api/plan/unlock', { body: '{}', site: 'cross-site' }))).status).toBe(403);
  });
});

describe('admin, layouts and companions', () => {
  it('model and membership edits need products.write and are audited', async () => {
    asStaff('support');
    await expect(saveMember({ model: 'commercial', productId: idOf(5), role: 'O' })).rejects.toBeInstanceOf(ForbiddenError);
    asStaff('catalog_editor');
    const before = (await loadModel('commercial'))!;
    const target = before.members.find((m) => m.role === 'M')!;
    await saveMember({ model: 'commercial', productId: target.productId, role: 'X', position: 0, isDefaultPick: true, spacingFt: [20, 20] });
    expect((await loadModel('commercial'))!.members.find((m) => m.productId === target.productId)).toMatchObject({ role: 'X', isDefaultPick: true, spacingFt: [20, 20] });
    expect(await removeMember({ model: 'commercial', productId: target.productId })).toBe(true);
    expect((await loadModel('commercial'))!.members.some((m) => m.productId === target.productId)).toBe(false);
    const created = await saveModel({
      slug: 'hedge',
      name: 'Hedge',
      colSpacingFt: 3,
      rowSpacingFt: 0,
      pattern: { kind: 'line', rows: ['MX'] },
      legend: { M: 'Main', X: 'Host', O: 'Biomass' },
      descriptionHtml: '<p>Close <script>x</script>hedge</p>',
    });
    expect(created).toEqual({ slug: 'hedge', created: true });
    const [row] = await t.db.select().from(plantingModel).where(eq(plantingModel.slug, 'hedge'));
    expect(row).toMatchObject({ blockHFt: 0, rowSpacingFt: 0, descriptionHtml: '<p>Close hedge</p>' });
    await expect(saveModel({ slug: 'grid', name: 'Grid', colSpacingFt: 3, rowSpacingFt: 0, pattern: { kind: 'rows', rows: ['MX'] }, legend: { M: 'a', X: 'b', O: 'c' } })).rejects.toThrow(/row spacing/);
    const actions = (await listAudit({ entity: 'planting_model' })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['planting.member.save', 'planting.member.remove', 'planting.model.create']));
    await t.db.delete(plantingModel).where(eq(plantingModel.slug, 'hedge'));
    await saveMember({ model: 'commercial', ...target, spacingFt: null });
    asGuest();
  });

  it('modelLayout: default picks on one acre, or an unlocked plan’s own plants', async () => {
    const generic = (await modelLayout('commercial'))!;
    expect(generic.perBlock).toEqual({ M: 3, X: 6, O: 9 });
    expect(generic.blocks).toBeCloseTo(33.61, 2);
    expect(await modelLayout('missing')).toBeNull();
    const { planId } = await generatePlan({ district: 'dryland', sqft: 2 * ACRE, purpose: 'commercial' }, visitor);
    await unlockPlan({ step: 'soft', planId, name: 'Asha', phone: '9845012345' }, { ip: null, requestHeaders: new Headers() });
    const own = (await modelLayout('commercial', { planId }))!;
    expect(own.blocks).toBeCloseTo(67.22, 2);
    expect(own.points.some((p) => wetOnly(p.productId))).toBe(false);
  });

  it('companions are co-members of a model in another role', async () => {
    const models = await loadModels({ activeOnly: true });
    const commercial = models.find((m) => m.slug === 'commercial')!;
    const main = commercial.members.find((m) => m.role === 'M')!;
    const ids = await companionIds(main.productId);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).not.toContain(main.productId);
    const roleIn = new Map(commercial.members.map((m) => [m.productId, m.role]));
    expect(ids.some((id) => roleIn.get(id) && roleIn.get(id) !== 'M')).toBe(true);
  });

  it('plans are stored per visitor with the district label snapshot', async () => {
    const rows = await t.db.select().from(plantingPlan).where(eq(plantingPlan.districtSlug, 'dryland')).limit(1);
    expect(rows[0]!.districtLabel).toEqual({ name: 'Dryland', stateName: 'Karnataka', distanceKm: 300 });
    expect(await t.db.select().from(plantingModelPlant).limit(1)).toHaveLength(1);
  });
});
