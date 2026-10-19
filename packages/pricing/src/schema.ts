// Pricing tables (BUILD-PLAN section 3, "pricing"). Every table is prefixed pricing_.
// Price changes are recorded in core_audit_log (before/after); there is no history table.
import { sql } from 'drizzle-orm';
import { char, check, index, integer, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { newId } from '@ecomkit/core/ids';

/**
 * One row per sellable variant. All amounts are GST-inclusive integer paise (A7).
 * `product_id` is carried so a price change can name its product (event + cache tag) without a
 * catalog query. No FK to catalog_variant: modules never reach into another module's tables.
 * `offline_price_paise` and `cost_paise` are admin-only and never leave the server API's admin calls.
 */
export const pricingPrice = pgTable(
  'pricing_price',
  {
    variantId: uuid('variant_id').primaryKey(),
    productId: uuid('product_id').notNull(),
    pricePaise: integer('price_paise').notNull(),
    compareAtPaise: integer('compare_at_paise'),
    offlinePricePaise: integer('offline_price_paise'),
    costPaise: integer('cost_paise'),
    currency: char('currency', { length: 3 }).notNull().default('INR'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('pricing_price_product_idx').on(t.productId),
    check('pricing_price_amounts_ck', sql`${t.pricePaise} >= 0 and coalesce(${t.offlinePricePaise}, 0) >= 0 and coalesce(${t.costPaise}, 0) >= 0`),
    check('pricing_price_compare_at_ck', sql`${t.compareAtPaise} is null or ${t.compareAtPaise} > ${t.pricePaise}`),
  ],
);

/** Bulk tiers: n per variant. The first tier's `min_qty` is the product's bulk threshold. */
export const pricingTier = pgTable(
  'pricing_tier',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => pricingPrice.variantId, { onDelete: 'cascade' }),
    minQty: integer('min_qty').notNull(),
    unitPricePaise: integer('unit_price_paise').notNull(),
  },
  (t) => [
    unique('pricing_tier_variant_min_qty_uq').on(t.variantId, t.minQty),
    check('pricing_tier_values_ck', sql`${t.minQty} >= 2 and ${t.unitPricePaise} >= 0`),
  ],
);

export type PricingPriceRow = typeof pricingPrice.$inferSelect;
export type PricingTierRow = typeof pricingTier.$inferSelect;
