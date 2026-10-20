// Planting tables (BUILD-PLAN section 3, "planting"). Every table is prefixed planting_.
// No foreign keys into catalog, customers or places: those modules own their tables and may be pushed
// separately; product ids, lead ids and district slugs are checked in code. Deviations: BUILD-STATUS/wp-24.md.
import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { newId } from '@ecomkit/core/ids';
import type { Legend, Pattern, PlanSelections, SpacingValue } from './domain/types';

const id = () => uuid('id').primaryKey().$defaultFn(newId);
const num = (name: string) => numeric(name, { mode: 'number' });

export const plantingRole = pgEnum('planting_role', ['M', 'X', 'O']);
export const plantingUnlockMode = pgEnum('planting_unlock_mode', ['otp', 'soft']);

export const plantingModel = pgTable('planting_model', {
  id: id(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  nameKn: text('name_kn'),
  /** Sanitised with core safeHtml on save. */
  descriptionHtml: text('description_html'),
  blockWFt: integer('block_w_ft').notNull().default(36),
  /** 0 for line models (Boundary). */
  blockHFt: integer('block_h_ft').notNull().default(36),
  colSpacingFt: num('col_spacing_ft').notNull(),
  rowSpacingFt: num('row_spacing_ft').notNull(),
  /** rows (cycling strings), random mix (seeded), or a single line. */
  pattern: jsonb('pattern').$type<Pattern>().notNull(),
  legend: jsonb('legend').$type<Legend>().notNull(),
  /** Per-unit cart weight for this model's package lines (Miyawaki saplings 0.8 kg). */
  weightOverrideKg: num('weight_override_kg'),
  position: integer('position').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const plantingModelPlant = pgTable(
  'planting_model_plant',
  {
    modelId: uuid('model_id')
      .notNull()
      .references(() => plantingModel.id, { onDelete: 'cascade' }),
    /** catalog product id (no FK: catalog owns the table). */
    productId: uuid('product_id').notNull(),
    role: plantingRole('role').notNull(),
    spacingFt: jsonb('spacing_ft').$type<SpacingValue>(),
    position: integer('position').notNull().default(0),
    isDefaultPick: boolean('is_default_pick').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.modelId, t.productId] }), index('planting_model_plant_product_idx').on(t.productId)],
);

export const plantingPlan = pgTable(
  'planting_plan',
  {
    id: id(),
    /** Random id from the `plan_visitor` cookie. */
    visitorId: text('visitor_id').notNull(),
    customerId: uuid('customer_id'),
    leadId: uuid('lead_id'),
    /** places district slug (DistrictRef has no id). */
    districtSlug: text('district_slug').notNull(),
    /** Snapshot for the summary chips: name, state, km. */
    districtLabel: jsonb('district_label').$type<{ name: string; stateName: string; distanceKm: number | null }>().notNull(),
    sqft: num('sqft').notNull(),
    boundaryFt: num('boundary_ft'),
    boundaryEstimated: boolean('boundary_estimated').notNull().default(false),
    /** Model slug the visitor chose (opened first on the results page). */
    purpose: text('purpose').notNull(),
    inputsIncluded: boolean('inputs_included').notNull().default(true),
    unlockMode: plantingUnlockMode('unlock_mode'),
    unlockedAt: timestamp('unlocked_at', { withTimezone: true }),
    /** Every active model computed at generation: lines per model plus blocks and totals. */
    selections: jsonb('selections').$type<PlanSelections>().notNull(),
    /** productId -> fit level for the district at generation time. */
    climateFit: jsonb('climate_fit').$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('planting_plan_list_idx').on(t.createdAt.desc(), t.id.desc()),
    index('planting_plan_lead_idx').on(t.leadId),
    index('planting_plan_customer_idx').on(t.customerId),
  ],
);

export type ModelRow = typeof plantingModel.$inferSelect;
export type MemberRow = typeof plantingModelPlant.$inferSelect;
export type PlanRow = typeof plantingPlan.$inferSelect;
