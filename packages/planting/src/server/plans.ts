import 'server-only';
import { eq, sql } from 'drizzle-orm';
import type { CartLineOrigin, PlanLayout } from '@ecomkit/core/contracts';
import { db, withTx } from '@ecomkit/core/db';
import { emit } from '@ecomkit/core/events';
import { hashContact, hashIp } from '@ecomkit/core/http';
import { newId, normalisePhone } from '@ecomkit/core/ids';
import { rateLimit } from '@ecomkit/core/rate-limit';
import { getSettings } from '@ecomkit/core/settings';
import { saveMyLand, upsertLead } from '@ecomkit/customers/server';
import {
  choosePicks,
  companionsOf,
  estimateBoundaryFt,
  generateInputSchema,
  inputsQuerySchema,
  membershipsOf,
  packageInputSchema,
  planLayout,
  recommendModel,
  saveLandInputSchema,
  toPicks,
  unlockInputSchema,
  SQFT_PER_ACRE,
  type FitLevel,
  type ModelSelection,
  type ModelWithMembers,
  type PlanSelections,
  type Role,
} from '../domain';
import { plantingPlan, type PlanRow } from '../schema';
import { plantingSettings, plantingSettingsSchema, type PlantingSettings } from '../settings';
import { loadModel, loadModels } from './models';
import { orElse, plantingRuntime, type InputLine, type ModelVideo, type PlantFacts } from './runtime';

/** A bad wizard answer the visitor can fix (`field` names the step). */
export class PlanInputError extends Error {
  constructor(readonly field: 'district' | 'purpose' | 'land' | 'limited') {
    super(`plan input: ${field}`);
    this.name = 'PlanInputError';
  }
}

export async function readPlantingSettings(): Promise<PlantingSettings> {
  return orElse(() => getSettings(plantingSettings), plantingSettingsSchema.parse({}));
}

const ipKey = (ip: string | null) => hashIp(ip) ?? 'unknown';

async function factsById(ids: readonly string[]): Promise<Map<string, PlantFacts>> {
  const facts = await plantingRuntime().products([...new Set(ids)]);
  return new Map(facts.map((f) => [f.productId, f]));
}

/** Visible members only (a hidden or deleted product drops out of every recommendation). */
const visibleMembers = (model: ModelWithMembers, facts: Map<string, PlantFacts>): ModelWithMembers => ({ ...model, members: model.members.filter((m) => facts.has(m.productId)) });

// ---- generation -----------------------------------------------------------------

/**
 * Creates a plan with every active model computed for the district and land (not only the chosen purpose), so the
 * results page can switch purpose without another round trip. Climate fit filters each model's plant set.
 */
export async function generatePlan(raw: unknown, ctx: { visitorId: string; customerId: string | null; ip: string | null }): Promise<{ planId: string }> {
  const parsed = generateInputSchema.safeParse(raw);
  if (!parsed.success) throw new PlanInputError(parsed.error.issues.some((i) => i.path[0] === 'district') ? 'district' : parsed.error.issues.some((i) => i.path[0] === 'purpose') ? 'purpose' : 'land');
  const input = parsed.data;
  if (!(await rateLimit(`plan-generate:${ipKey(ctx.ip)}`, { limit: 30, windowSec: 3600 })).ok) throw new PlanInputError('limited');
  const rt = plantingRuntime();
  const district = await rt.places.getDistrict(input.district);
  if (!district) throw new PlanInputError('district');
  const models = await loadModels({ activeOnly: true });
  if (!models.some((m) => m.slug === input.purpose)) throw new PlanInputError('purpose');
  const facts = await factsById(models.flatMap((m) => m.members.map((x) => x.productId)));
  const fit: Record<string, FitLevel> = {};
  await Promise.all(
    [...facts.values()].map(async (f) => {
      if (f.climate) fit[f.productId] = (await rt.places.fit(district.slug, f.climate)).level;
    }),
  );
  const settings = await readPlantingSettings();
  const planId = newId();
  const land = { sqft: input.sqft, boundaryFt: input.boundaryFt ?? null };
  const selections: PlanSelections = {};
  for (const model of models) selections[model.slug] = recommendModel(visibleMembers(model, facts), fit, land, { perRole: settings.picks_per_role, seed: planId });
  await withTx(async (tx) => {
    await tx.insert(plantingPlan).values({
      id: planId,
      visitorId: ctx.visitorId,
      customerId: ctx.customerId,
      districtSlug: district.slug,
      districtLabel: { name: district.name, stateName: district.stateName, distanceKm: district.distanceKm },
      sqft: input.sqft,
      boundaryFt: input.boundaryFt ?? null,
      boundaryEstimated: input.boundaryFt === undefined,
      purpose: input.purpose,
      selections,
      climateFit: fit,
    });
    await emit('plan.generated', { planId, modelSlug: input.purpose }, { tx });
  });
  return { planId };
}

export async function getPlan(planId: string): Promise<PlanRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(planId)) return null;
  const [row] = await db.select().from(plantingPlan).where(eq(plantingPlan.id, planId)).limit(1);
  return row ?? null;
}

// ---- the results page -------------------------------------------------------------

export interface PriceHint {
  listUnitPaise: number;
  tier: { minQty: number; unitPaise: number } | null;
  nextTier: { minQty: number; unitPaise: number } | null;
}

export interface LineView {
  productId: string;
  role: Role;
  /** Null while the plan is locked: quantities and prices are not sent before unlock. */
  recommendedQty: number | null;
  price: PriceHint | null;
  facts: PlantFacts;
}

export interface ModelView {
  slug: string;
  name: string;
  descriptionHtml: string | null;
  legend: Record<Role, string>;
  isLine: boolean;
  layout: PlanLayout;
  blocks: number;
  totalPlants: number | null;
  emptyRoles: Role[];
  lines: LineView[];
  alternates: LineView[];
  videos: ModelVideo[];
  inputs: InputLine[];
}

export interface PlanView {
  id: string;
  unlocked: boolean;
  unlockMode: 'soft' | 'otp';
  district: { slug: string; name: string; stateName: string; distanceKm: number | null };
  sqft: number;
  boundaryFt: number;
  boundaryEstimated: boolean;
  purpose: string;
  inputsIncluded: boolean;
  models: ModelView[];
  buildForMeHref: string;
  has3d: boolean;
  cartEnabled: boolean;
}

const fitOf = (plan: PlanRow) => plan.climateFit as Record<string, FitLevel>;

async function priceHints(lines: readonly { variantId: string | null; qty: number }[]): Promise<Record<string, PriceHint>> {
  const pricing = plantingRuntime().pricing;
  const items = lines.flatMap((l) => (l.variantId ? [{ variantId: l.variantId, qty: Math.max(1, l.qty) }] : []));
  if (!pricing || !items.length) return {};
  const quotes = await orElse(() => pricing.getPrices(items), {});
  return Object.fromEntries(Object.entries(quotes).map(([k, q]) => [k, { listUnitPaise: q.listUnitPaise, tier: q.tier, nextTier: q.nextTier }]));
}

async function modelView(model: ModelWithMembers, selection: ModelSelection, plan: PlanRow, facts: Map<string, PlantFacts>, unlocked: boolean, perRole: number): Promise<ModelView> {
  const rt = plantingRuntime();
  const visible = visibleMembers(model, facts);
  const { alternates } = choosePicks(visible.members, fitOf(plan), perRole);
  const lines = selection.lines.filter((l) => facts.has(l.productId));
  const inPlan = new Set(lines.map((l) => l.productId));
  const picks = { M: [] as typeof lines, X: [] as typeof lines, O: [] as typeof lines };
  for (const l of lines) picks[l.role].push(l);
  const label = (id: string) => facts.get(id)?.name ?? '';
  const layout = planLayout(
    model,
    { M: picks.M.map((l) => ({ productId: l.productId, label: label(l.productId) })), X: picks.X.map((l) => ({ productId: l.productId, label: label(l.productId) })), O: picks.O.map((l) => ({ productId: l.productId, label: label(l.productId) })) },
    { sqft: plan.sqft, boundaryFt: plan.boundaryFt },
    { seed: plan.id },
  );
  const altMembers = (['M', 'X', 'O'] as const).flatMap((r) => alternates[r]).filter((m) => !inPlan.has(m.productId));
  const [prices, videos, inputs] = await Promise.all([
    unlocked ? priceHints([...lines, ...altMembers.map((m) => ({ productId: m.productId, qty: 1 }))].map((l) => ({ variantId: facts.get(l.productId)?.variantId ?? null, qty: l.qty }))) : Promise.resolve({} as Record<string, PriceHint>),
    rt.videos ? orElse(() => rt.videos!(model.slug), [] as ModelVideo[]) : Promise.resolve([] as ModelVideo[]),
    unlocked && rt.inputs ? orElse(() => rt.inputs!.recommend({ lines, sqft: plan.sqft }), [] as InputLine[]) : Promise.resolve([] as InputLine[]),
  ]);
  const view = (productId: string, role: Role, qty: number): LineView => {
    const f = facts.get(productId)!;
    return { productId, role, recommendedQty: unlocked ? qty : null, price: unlocked && f.variantId ? (prices[f.variantId] ?? null) : null, facts: f };
  };
  return {
    slug: model.slug,
    name: model.name,
    descriptionHtml: model.descriptionHtml,
    legend: model.legend,
    isLine: model.pattern.kind === 'line' || model.blockFt.h === 0,
    layout,
    blocks: selection.blocks,
    totalPlants: unlocked ? lines.reduce((s, l) => s + l.qty, 0) : null,
    emptyRoles: selection.emptyRoles,
    lines: lines.map((l) => view(l.productId, l.role, l.qty)),
    alternates: altMembers.map((m) => view(m.productId, m.role, 0)),
    videos,
    inputs,
  };
}

/** Everything the results page renders. Locked plans carry no quantities, prices or inputs. */
export async function planView(planId: string): Promise<PlanView | null> {
  const plan = await getPlan(planId);
  if (!plan) return null;
  const rt = plantingRuntime();
  const [models, settings] = await Promise.all([loadModels({ activeOnly: true }), readPlantingSettings()]);
  const known = models.filter((m) => plan.selections[m.slug]);
  const facts = await factsById(known.flatMap((m) => m.members.map((x) => x.productId)));
  const unlocked = plan.unlockedAt !== null;
  const ordered = [...known].sort((a, b) => Number(b.slug === plan.purpose) - Number(a.slug === plan.purpose) || a.position - b.position);
  const views = await Promise.all(ordered.map((m) => modelView(m, plan.selections[m.slug]!, plan, facts, unlocked, settings.picks_per_role)));
  const label = plan.districtLabel;
  const acres = plan.sqft / SQFT_PER_ACRE;
  const query = new URLSearchParams({ source: 'plan', plan: plan.id, district: label.name, acres: acres.toFixed(2) });
  return {
    id: plan.id,
    unlocked,
    unlockMode: settings.unlock_mode,
    district: { slug: plan.districtSlug, ...label },
    sqft: plan.sqft,
    boundaryFt: plan.boundaryFt ?? estimateBoundaryFt(plan.sqft),
    boundaryEstimated: plan.boundaryEstimated,
    purpose: plan.purpose,
    inputsIncluded: plan.inputsIncluded,
    models: views,
    buildForMeHref: `${settings.build_for_me_path}?${query}`,
    has3d: rt.registry?.has('planting-3d') ?? false,
    cartEnabled: rt.cart !== null,
  };
}

// ---- unlock -----------------------------------------------------------------------

export type UnlockStatus = 'unlocked' | 'sent' | 'invalid' | 'code_invalid' | 'limited' | 'not_found' | 'wrong_mode' | 'not_configured';

async function limitUnlock(ip: string | null, phoneHash: string): Promise<boolean> {
  const [byIp, byPhone] = await Promise.all([
    rateLimit(`plan-unlock:${ipKey(ip)}`, { limit: 20, windowSec: 3600 }),
    rateLimit(`plan-unlock:${phoneHash}`, { limit: 8, windowSec: 3600 }),
  ]);
  return byIp.ok && byPhone.ok;
}

async function markUnlocked(plan: PlanRow, lead: { name: string; phone: string; verified: boolean; userId: string | null }, mode: 'soft' | 'otp'): Promise<void> {
  await withTx(async (tx) => {
    const { leadId } = await upsertLead(
      {
        name: lead.name,
        phone: lead.phone,
        source: 'wizard',
        phoneVerified: lead.verified,
        userId: lead.userId,
        context: { ref: plan.id, district: plan.districtSlug, sqft: plan.sqft, purpose: plan.purpose },
      },
      { tx },
    );
    await tx
      .update(plantingPlan)
      .set({ leadId, unlockMode: mode, unlockedAt: sql`coalesce(${plantingPlan.unlockedAt}, now())`, ...(lead.userId ? { customerId: lead.userId } : {}) })
      .where(eq(plantingPlan.id, plan.id));
    await emit('plan.unlocked', { planId: plan.id, leadId, mode }, { tx });
  });
}

/**
 * One entry for the three unlock steps. `soft` (default mode, A23): name + phone create an unverified lead and
 * unlock the plan; nobody is signed in. `send` / `verify` (otp mode): a code through the auth module; a good code
 * creates a verified lead, signs the customer in (the returned headers carry the session cookie) and unlocks.
 */
export async function unlockPlan(raw: unknown, ctx: { ip: string | null; requestHeaders: Headers }): Promise<{ status: UnlockStatus; headers?: Headers }> {
  const parsed = unlockInputSchema.safeParse(raw);
  if (!parsed.success) return { status: parsed.error.issues.some((i) => i.path[0] === 'code') ? 'code_invalid' : 'invalid' };
  const input = parsed.data;
  const phone = normalisePhone(input.phone);
  const phoneHash = phone ? hashContact(phone) : null;
  if (!phone || !phoneHash) return { status: 'invalid' };
  if (!(await limitUnlock(ctx.ip, phoneHash))) return { status: 'limited' };
  const plan = await getPlan(input.planId);
  if (!plan) return { status: 'not_found' };
  const mode = (await readPlantingSettings()).unlock_mode;
  if ((input.step === 'soft') !== (mode === 'soft')) return { status: 'wrong_mode' };
  if (input.step === 'soft') {
    await markUnlocked(plan, { name: input.name, phone, verified: false, userId: null }, 'soft');
    return { status: 'unlocked' };
  }
  const otp = plantingRuntime().otp;
  if (!otp) return { status: 'not_configured' };
  if (input.step === 'send') {
    const r = await otp.send({ identifier: phone, ip: ctx.ip });
    return { status: r.status === 'sent' ? 'sent' : r.status === 'rate_limited' ? 'limited' : 'invalid' };
  }
  const r = await otp.verify({ identifier: phone, code: input.code, requestHeaders: ctx.requestHeaders });
  if (r.status !== 'ok' || !('userId' in r)) return { status: r.status === 'rate_limited' ? 'limited' : 'code_invalid' };
  await markUnlocked(plan, { name: input.name, phone, verified: true, userId: r.userId }, 'otp');
  return { status: 'unlocked', headers: r.headers };
}

// ---- package to cart, inputs, land ----------------------------------------------------

export type PackageStatus = 'added' | 'invalid' | 'not_found' | 'locked' | 'cart_unavailable' | 'failed';

async function unlockedPlanAndModel(planId: string, modelSlug: string): Promise<{ plan: PlanRow; model: ModelWithMembers } | 'not_found' | 'locked'> {
  const plan = await getPlan(planId);
  if (!plan || !plan.selections[modelSlug]) return 'not_found';
  if (!plan.unlockedAt) return 'locked';
  const model = await loadModel(modelSlug);
  return model ? { plan, model } : 'not_found';
}

/** Inputs for edited plant quantities (the results page keeps inputs following plant edits until hand-edited). */
export async function inputsFor(raw: unknown): Promise<InputLine[]> {
  const input = inputsQuerySchema.parse(raw);
  const found = await unlockedPlanAndModel(input.planId, input.model);
  const inputsPort = plantingRuntime().inputs;
  if (typeof found === 'string' || !inputsPort) return [];
  const roleOf = new Map(found.model.members.map((m) => [m.productId, m.role]));
  const lines = input.lines.flatMap((l) => (roleOf.has(l.productId) && l.qty > 0 ? [{ productId: l.productId, role: roleOf.get(l.productId)!, qty: l.qty }] : []));
  return orElse(() => inputsPort.recommend({ lines, sqft: found.plan.sqft }), []);
}

/**
 * Replaces the cart's planting package with this model's lines (and inputs when included). Only unlocked plans;
 * every product must be a member of the model and every input one the engine recommends for these plants.
 * Model weight override (Miyawaki 0.8 kg) travels as `origin.weightKg`.
 */
export async function addPackage(raw: unknown): Promise<{ status: PackageStatus }> {
  const parsed = packageInputSchema.safeParse(raw);
  if (!parsed.success) return { status: 'invalid' };
  const input = parsed.data;
  const found = await unlockedPlanAndModel(input.planId, input.model);
  if (typeof found === 'string') return { status: found };
  const rt = plantingRuntime();
  if (!rt.cart) return { status: 'cart_unavailable' };
  const { model } = found;
  const members = new Set(model.members.map((m) => m.productId));
  const plants = input.lines.filter((l) => l.qty > 0);
  if (!plants.length || plants.some((l) => !members.has(l.productId))) return { status: 'invalid' };
  const facts = await factsById(plants.map((l) => l.productId));
  const origin: CartLineOrigin = { source: 'planting', modelSlug: model.slug, ...(model.weightOverrideKg ? { weightKg: model.weightOverrideKg } : {}) };
  const lines: { productId: string; variantId: string; qty: number; origin: CartLineOrigin }[] = [];
  for (const l of plants) {
    const variantId = facts.get(l.productId)?.variantId;
    if (!variantId) return { status: 'invalid' };
    lines.push({ productId: l.productId, variantId, qty: l.qty, origin });
  }
  const wantedInputs = input.inputs.filter((i) => i.qty > 0);
  if (wantedInputs.length) {
    const allowed = new Map((await inputsFor({ planId: input.planId, model: input.model, lines: plants })).map((i) => [i.variantId, i]));
    for (const i of wantedInputs) {
      const known = allowed.get(i.variantId);
      if (!known) return { status: 'invalid' };
      lines.push({ productId: known.productId, variantId: i.variantId, qty: i.qty, origin: { source: 'planting', modelSlug: model.slug } });
    }
  }
  const r = await orElse(() => rt.cart!.replacePackage({ packageKey: 'planting', label: model.name, lines }), { ok: false });
  return { status: r.ok ? 'added' : 'failed' };
}

/** "Save this land" for a signed-in customer (customers' land profiles; a guest gets the customers module's error). */
export async function saveLandFromPlan(raw: unknown): Promise<{ id: string } | null> {
  const input = saveLandInputSchema.parse(raw);
  const plan = await getPlan(input.planId);
  if (!plan?.unlockedAt) return null;
  const row = await saveMyLand({ label: input.label, sqft: plan.sqft, purpose: plan.purpose, planId: plan.id });
  return { id: row.id };
}

// ---- layouts and companions for other modules -------------------------------------------

/**
 * `PlanLayout` for a model: the plan's own plants when `planId` names a plan that holds this model, otherwise the
 * model's default picks on one acre. Used by the 3D viewer and the model pages.
 */
export async function modelLayout(modelSlug: string, options: { planId?: string | null } = {}): Promise<PlanLayout | null> {
  const model = await loadModel(modelSlug);
  if (!model?.isActive) return null;
  const plan = options.planId ? await getPlan(options.planId) : null;
  const facts = await factsById(model.members.map((m) => m.productId));
  const label = (id: string) => facts.get(id)?.name ?? '';
  if (plan?.selections[modelSlug] && plan.unlockedAt) {
    const sel = plan.selections[modelSlug]!;
    const byRole = (r: Role) => sel.lines.filter((l) => l.role === r).map((l) => ({ productId: l.productId, label: label(l.productId) }));
    return planLayout(model, { M: byRole('M'), X: byRole('X'), O: byRole('O') }, { sqft: plan.sqft, boundaryFt: plan.boundaryFt }, { seed: plan.id });
  }
  const settings = await readPlantingSettings();
  const { picks } = choosePicks(visibleMembers(model, facts).members, {}, settings.picks_per_role);
  return planLayout(model, toPicks(picks, label), { sqft: SQFT_PER_ACRE, boundaryFt: null });
}

/** "Grows well with" product ids for a plant (PDP section, assistant facts). */
export async function companionIds(productId: string, limit = 6): Promise<string[]> {
  const rt = plantingRuntime();
  const [models, fixers] = await Promise.all([loadModels({ activeOnly: true }), orElse(() => rt.nitrogenFixers(), new Set<string>())]);
  return companionsOf(productId, membershipsOf(models), fixers, limit);
}
