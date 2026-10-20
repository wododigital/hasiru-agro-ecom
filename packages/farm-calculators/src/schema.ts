// farm-calculators tables (BUILD-PLAN section 3). Deviations from the plan's column list: BUILD-STATUS/wp-25.md A25-2.
import { newId } from '@ecomkit/core/ids';
import { boolean, index, integer, numeric, pgEnum, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { AGE_BANDS, BASES, RULE_ROLES, UNITS } from './domain/dosage';

export const farmcalcBasis = pgEnum('farmcalc_basis', BASES);
export const farmcalcRole = pgEnum('farmcalc_role', RULE_ROLES);
export const farmcalcAgeBand = pgEnum('farmcalc_age_band', AGE_BANDS);
export const farmcalcUnit = pgEnum('farmcalc_unit', UNITS);

/**
 * How much of an input (a catalog product of kind `input`) a plant or an acre needs. `input_product_id` is a plain
 * uuid, not a foreign key: modules never constrain each other's tables, so this module can be enabled or dropped alone.
 */
export const farmcalcDosageRule = pgTable(
  'farmcalc_dosage_rule',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    inputProductId: uuid('input_product_id').notNull(),
    basis: farmcalcBasis('basis').notNull().default('per_plant'),
    role: farmcalcRole('role').notNull().default('any'),
    ageBand: farmcalcAgeBand('age_band').notNull().default('at_planting'),
    /** kg or L per plant (per_plant) or per acre (per_acre). */
    amount: numeric('amount', { mode: 'number' }).notNull(),
    packSize: numeric('pack_size', { mode: 'number' }).notNull(),
    unit: farmcalcUnit('unit').notNull().default('kg'),
    minPacks: integer('min_packs').notNull().default(0),
    usePlantCompost: boolean('use_plant_compost').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('farmcalc_dosage_rule_key').on(t.inputProductId, t.basis, t.role, t.ageBand),
    index('farmcalc_dosage_rule_position_idx').on(t.isActive, t.position),
  ],
);
