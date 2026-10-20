'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { audit } from '@ecomkit/core/audit';
import { getViewer } from '@ecomkit/core/auth-context';
import { db } from '@ecomkit/core/db';
import { newId, SLUG_RE } from '@ecomkit/core/ids';
import { paise } from '@ecomkit/core/money';
import { zodAction } from '@ecomkit/core/validation';
import { METHOD_KINDS, methodRuleSchemas, PACKING_SCOPES, packingMatchSchemas, ZONE_KINDS } from '../domain';
import { shippingDistanceOverride, shippingMethod, shippingPackingRule, shippingSlot, shippingVehicle, shippingZone } from '../schema';

// Delivery panel actions (settings.customPanel). Every write is permission-checked, audited and re-renders the panel.

const PANEL_PATH = '/admin/settings/shipping';
const id = z.string().uuid();
const optionalId = z.union([z.literal(''), id]).optional().transform((v) => v || null);
const checkbox = z.union([z.literal('on'), z.literal('true'), z.literal('')]).optional().transform((v) => v === 'on' || v === 'true');
const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
const rupees = z.coerce.number().min(0).max(10_000_000).transform((v) => paise(v));
const list = (re: RegExp, transform: (s: string) => string) =>
  z
    .string()
    .max(4000)
    .default('')
    .transform((v) => [...new Set(v.split(/[\s,]+/).map(transform).filter(Boolean))])
    .pipe(z.array(z.string().regex(re)).max(800));
const json = z.string().max(8000).default('{}').transform((v, ctx) => {
  try {
    return JSON.parse(v || '{}') as unknown;
  } catch {
    ctx.addIssue({ code: 'custom', message: 'not valid JSON' });
    return z.NEVER;
  }
});

async function record(action: string, entity: string, entityId: string, before: unknown, after: unknown): Promise<void> {
  const viewer = await getViewer();
  await audit({ actorId: viewer.kind === 'staff' ? viewer.userId : null, actorType: 'staff', action, entity, entityId, before, after });
  revalidatePath(PANEL_PATH);
}

export const saveZone = zodAction(
  z.object({
    id: optionalId,
    slug: z.string().trim().regex(SLUG_RE).max(60),
    name: z.string().trim().min(1).max(80),
    kind: z.enum(ZONE_KINDS),
    district_slugs: list(SLUG_RE, (s) => s.trim().toLowerCase()),
    state_codes: list(/^[A-Z]{2}$/, (s) => s.trim().toUpperCase()),
    position: int(0, 10_000).default(0),
  }),
  async (v) => {
    const row = { slug: v.slug, name: v.name, kind: v.kind, districtSlugs: v.district_slugs, stateCodes: v.state_codes, position: v.position, updatedAt: new Date() };
    const before = v.id ? (await db.select().from(shippingZone).where(eq(shippingZone.id, v.id)))[0] ?? null : null;
    const rowId = v.id ?? newId();
    if (v.id) await db.update(shippingZone).set(row).where(eq(shippingZone.id, v.id));
    else await db.insert(shippingZone).values({ id: rowId, ...row });
    await record('shipping.zone.save', 'shipping_zone', rowId, before, row);
    return { id: rowId };
  },
  { permission: 'settings.write' },
);

export const saveMethod = zodAction(
  z
    .object({
      id: optionalId,
      name: z.string().trim().min(1).max(80),
      kind: z.enum(METHOD_KINDS),
      zone_id: optionalId,
      is_active: checkbox,
      rules: json,
      position: int(0, 10_000).default(0),
    })
    .transform((v, ctx) => {
      const rules = methodRuleSchemas[v.kind].safeParse(v.rules);
      if (!rules.success) {
        ctx.addIssue({ code: 'custom', path: ['rules'], message: rules.error.issues[0]?.message ?? 'invalid rules' });
        return z.NEVER;
      }
      return { ...v, rules: rules.data };
    }),
  async (v) => {
    const row = { name: v.name, kind: v.kind, zoneId: v.kind === 'pickup' ? null : v.zone_id, isActive: v.is_active, rules: v.rules, position: v.position, updatedAt: new Date() };
    const before = v.id ? (await db.select().from(shippingMethod).where(eq(shippingMethod.id, v.id)))[0] ?? null : null;
    const rowId = v.id ?? newId();
    if (v.id) await db.update(shippingMethod).set(row).where(eq(shippingMethod.id, v.id));
    else await db.insert(shippingMethod).values({ id: rowId, ...row });
    await record('shipping.method.save', 'shipping_method', rowId, before, row);
    return { id: rowId };
  },
  { permission: 'settings.write' },
);

export const saveVehicle = zodAction(
  z.object({
    id: optionalId,
    name: z.string().trim().min(1).max(80),
    capacity_kg: int(1, 100_000),
    local_flat_rs: rupees,
    per_km_rs: rupees,
    is_active: checkbox,
    position: int(0, 10_000).default(0),
  }),
  async (v) => {
    const row = { name: v.name, capacityKg: v.capacity_kg, localFlatPaise: v.local_flat_rs, perKmPaise: v.per_km_rs, isActive: v.is_active, position: v.position, updatedAt: new Date() };
    const before = v.id ? (await db.select().from(shippingVehicle).where(eq(shippingVehicle.id, v.id)))[0] ?? null : null;
    const rowId = v.id ?? newId();
    if (v.id) await db.update(shippingVehicle).set(row).where(eq(shippingVehicle.id, v.id));
    else await db.insert(shippingVehicle).values({ id: rowId, ...row });
    await record('shipping.vehicle.save', 'shipping_vehicle', rowId, before, row);
    return { id: rowId };
  },
  { permission: 'settings.write' },
);

export const saveSlot = zodAction(
  z.object({
    id: optionalId,
    weekday: int(0, 6),
    cutoff_hours: int(0, 24 * 14),
    capacity_kg: z.union([z.literal(''), int(1, 1_000_000)]).optional().transform((v) => (v === '' || v === undefined ? null : v)),
    is_active: checkbox,
  }),
  async (v) => {
    const row = { weekday: v.weekday, cutoffHours: v.cutoff_hours, capacityKg: v.capacity_kg, isActive: v.is_active, updatedAt: new Date() };
    const before = v.id ? (await db.select().from(shippingSlot).where(eq(shippingSlot.id, v.id)))[0] ?? null : null;
    const rowId = v.id ?? newId();
    if (v.id) await db.update(shippingSlot).set(row).where(eq(shippingSlot.id, v.id));
    else await db.insert(shippingSlot).values({ id: rowId, ...row });
    await record('shipping.slot.save', 'shipping_slot', rowId, before, row);
    return { id: rowId };
  },
  { permission: 'settings.write' },
);

export const savePackingRule = zodAction(
  z
    .object({ id: optionalId, scope: z.enum(PACKING_SCOPES), match: json, fee_rs: rupees, position: int(0, 10_000).default(0) })
    .transform((v, ctx) => {
      const match = packingMatchSchemas[v.scope].safeParse(v.match);
      if (!match.success) {
        ctx.addIssue({ code: 'custom', path: ['match'], message: match.error.issues[0]?.message ?? 'invalid match' });
        return z.NEVER;
      }
      return { ...v, match: match.data };
    }),
  async (v) => {
    const row = { scope: v.scope, match: v.match, feePaise: v.fee_rs, position: v.position, updatedAt: new Date() };
    const before = v.id ? (await db.select().from(shippingPackingRule).where(eq(shippingPackingRule.id, v.id)))[0] ?? null : null;
    const rowId = v.id ?? newId();
    if (v.id) await db.update(shippingPackingRule).set(row).where(eq(shippingPackingRule.id, v.id));
    else await db.insert(shippingPackingRule).values({ id: rowId, ...row });
    await record('shipping.packing_rule.save', 'shipping_packing_rule', rowId, before, row);
    return { id: rowId };
  },
  { permission: 'settings.write' },
);

export const saveDistance = zodAction(
  z.object({ district_slug: z.string().trim().toLowerCase().regex(SLUG_RE).max(80), km: z.coerce.number().min(0).max(5000), note: z.string().trim().max(200).default('') }),
  async (v) => {
    const row = { km: v.km, note: v.note || null, updatedAt: new Date() };
    await db
      .insert(shippingDistanceOverride)
      .values({ districtSlug: v.district_slug, ...row })
      .onConflictDoUpdate({ target: shippingDistanceOverride.districtSlug, set: row });
    await record('shipping.distance.save', 'shipping_distance_override', v.district_slug, null, row);
    return { districtSlug: v.district_slug };
  },
  { permission: 'settings.write' },
);

const TABLES = {
  zone: shippingZone,
  method: shippingMethod,
  vehicle: shippingVehicle,
  slot: shippingSlot,
  packing_rule: shippingPackingRule,
} as const;

export const deleteRow = zodAction(
  z.object({ table: z.enum(['zone', 'method', 'vehicle', 'slot', 'packing_rule', 'distance']), id: z.string().min(1).max(80) }),
  async ({ table, id: rowId }) => {
    if (table === 'distance') {
      await db.delete(shippingDistanceOverride).where(eq(shippingDistanceOverride.districtSlug, rowId));
    } else {
      if (!id.safeParse(rowId).success) return { deleted: false };
      const t = TABLES[table];
      await db.delete(t).where(eq(t.id, rowId));
    }
    await record(`shipping.${table}.delete`, `shipping_${table === 'distance' ? 'distance_override' : table}`, rowId, null, null);
    return { deleted: true };
  },
  { permission: 'settings.write' },
);

// Form actions return void; the panel re-renders with the new rows (errors show as unchanged rows).
export async function saveZoneForm(form: FormData): Promise<void> {
  await saveZone(form);
}
export async function saveMethodForm(form: FormData): Promise<void> {
  await saveMethod(form);
}
export async function saveVehicleForm(form: FormData): Promise<void> {
  await saveVehicle(form);
}
export async function saveSlotForm(form: FormData): Promise<void> {
  await saveSlot(form);
}
export async function savePackingRuleForm(form: FormData): Promise<void> {
  await savePackingRule(form);
}
export async function saveDistanceForm(form: FormData): Promise<void> {
  await saveDistance(form);
}
export async function deleteRowForm(form: FormData): Promise<void> {
  await deleteRow(form);
}
