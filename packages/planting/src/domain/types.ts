// Planting vocabulary and every boundary schema. Pure: no React, no Next, no database.
import { z } from 'zod';
import { ROLES, type Role } from '@ecomkit/core/contracts';

export { ROLES, type Role };

export const SQFT_PER_ACRE = 43_560;
export const MIN_ACRES = 0.1;
export const MIN_SQFT = Math.round(MIN_ACRES * SQFT_PER_ACRE);
/** 10,000 acres: well above any farm this store plans. */
export const MAX_SQFT = 10_000 * SQFT_PER_ACRE;
export const MAX_BOUNDARY_FT = 500_000;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const slugSchema = z.string().regex(SLUG).max(80);
const roleRow = z.string().regex(/^[MXO]+$/, 'pattern rows use only M, X and O').max(64);
const share = z.number().min(0).max(1);

/** `rows`: strings cycle per row and per column. `random`: shares placed by a seeded shuffle. `line`: one row along a boundary. */
export const patternSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('rows'), rows: z.array(roleRow).min(1).max(12) }),
  z.object({ kind: z.literal('random'), mix: z.object({ M: share, X: share, O: share }).refine((m) => m.M + m.X + m.O > 0, 'mix needs a share'), seed: z.number().int().nullable() }),
  z.object({ kind: z.literal('line'), rows: z.array(roleRow).length(1) }),
]);
export type Pattern = z.infer<typeof patternSchema>;

export const legendSchema = z.object({ M: z.string().min(1).max(40), X: z.string().min(1).max(40), O: z.string().min(1).max(40) });
export type Legend = z.infer<typeof legendSchema>;

/** [length, width] in feet, or one distance for line models. */
export type SpacingValue = [number, number] | number;
export const spacingSchema = z.union([z.tuple([z.number().positive().max(200), z.number().positive().max(200)]), z.number().positive().max(200)]);

export interface ModelDef {
  slug: string;
  name: string;
  nameKn: string | null;
  descriptionHtml: string | null;
  blockFt: { w: number; h: number };
  spacingFt: { plant: number; row: number };
  pattern: Pattern;
  legend: Legend;
  weightOverrideKg: number | null;
  position: number;
  isActive: boolean;
}

export interface Member {
  productId: string;
  role: Role;
  spacingFt: SpacingValue | null;
  position: number;
  isDefaultPick: boolean;
}

export interface ModelWithMembers extends ModelDef {
  members: Member[];
}

export type FitLevel = 'good' | 'ok' | 'not_recommended';

export interface PlanLine {
  productId: string;
  role: Role;
  qty: number;
}

/** What generation stores per model (`planting_plan.selections`). */
export interface ModelSelection {
  lines: PlanLine[];
  blocks: number;
  totalPlants: number;
  /** Roles left empty because no member fits the district. */
  emptyRoles: Role[];
}
export type PlanSelections = Record<string, ModelSelection>;

// ---- inputs at the HTTP / action boundary ------------------------------------

const positive = (max: number) => z.coerce.number().positive().max(max);

export const generateInputSchema = z.object({
  district: slugSchema,
  sqft: positive(MAX_SQFT).min(MIN_SQFT),
  boundaryFt: z.preprocess((v) => (v === '' || v === null ? undefined : v), positive(MAX_BOUNDARY_FT).optional()),
  purpose: slugSchema,
});
export type GenerateInput = z.output<typeof generateInputSchema>;

export const unlockInputSchema = z.discriminatedUnion('step', [
  z.object({ step: z.literal('soft'), planId: z.uuid(), name: z.string().trim().min(1).max(120), phone: z.string().trim().min(10).max(20) }),
  z.object({ step: z.literal('send'), planId: z.uuid(), name: z.string().trim().min(1).max(120), phone: z.string().trim().min(10).max(20) }),
  z.object({ step: z.literal('verify'), planId: z.uuid(), name: z.string().trim().min(1).max(120), phone: z.string().trim().min(10).max(20), code: z.string().regex(/^\d{6}$/) }),
]);
export type UnlockInput = z.output<typeof unlockInputSchema>;

const qty = z.coerce.number().int().min(0).max(100_000);

export const packageInputSchema = z.object({
  planId: z.uuid(),
  model: slugSchema,
  lines: z.array(z.object({ productId: z.uuid(), qty })).max(200),
  inputs: z.array(z.object({ variantId: z.uuid(), qty })).max(20).default([]),
});
export type PackageInput = z.output<typeof packageInputSchema>;

export const inputsQuerySchema = z.object({
  planId: z.uuid(),
  model: slugSchema,
  lines: z.array(z.object({ productId: z.uuid(), qty })).max(200),
});

export const saveLandInputSchema = z.object({ planId: z.uuid(), label: z.string().trim().min(1).max(80) });

/** Admin: model fields (the pattern arrives as text, one row per line, or the random mix). */
export const modelFieldsSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(80),
  nameKn: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(80).nullable()).default(null),
  descriptionHtml: z.preprocess((v) => (v === '' ? null : v), z.string().max(4000).nullable()).default(null),
  colSpacingFt: positive(100),
  rowSpacingFt: z.coerce.number().min(0).max(100),
  pattern: patternSchema,
  legend: legendSchema,
  weightOverrideKg: z.preprocess((v) => (v === '' || v === null ? null : v), z.coerce.number().positive().max(100).nullable()).default(null),
  position: z.coerce.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
});
export type ModelFields = z.output<typeof modelFieldsSchema>;

export const memberFieldsSchema = z.object({
  model: slugSchema,
  productId: z.uuid(),
  role: z.enum(ROLES as unknown as [Role, ...Role[]]),
  position: z.coerce.number().int().min(0).max(1000).default(0),
  isDefaultPick: z.boolean().default(false),
  spacingFt: spacingSchema.nullable().default(null),
});
export type MemberFields = z.output<typeof memberFieldsSchema>;
