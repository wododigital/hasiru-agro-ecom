// Discount tables (BUILD-PLAN section 3, "discounts"). Every table is prefixed discounts_.
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { newId } from '@ecomkit/core/ids';

export const discountsKind = pgEnum('discounts_kind', ['automatic', 'code']);
export const discountsStatus = pgEnum('discounts_status', ['draft', 'active', 'paused', 'archived']);
export const discountsValueType = pgEnum('discounts_value_type', ['percent', 'fixed']);
export const discountsAppliesTo = pgEnum('discounts_applies_to', ['order', 'collection', 'products', 'tags']);
export const discountsEligibility = pgEnum('discounts_eligibility', ['all', 'segment', 'first_order']);

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/**
 * A promotion. `kind = automatic` applies by itself; `kind = code` needs one of its codes.
 * `value` is a whole percent (1..100) or fixed paise. Window: starts_at inclusive, ends_at exclusive.
 */
export const discountsRule = pgTable(
  'discounts_rule',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    name: text('name').notNull(),
    kind: discountsKind('kind').notNull(),
    status: discountsStatus('status').notNull().default('draft'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    valueType: discountsValueType('value_type').notNull(),
    value: integer('value').notNull(),
    appliesTo: discountsAppliesTo('applies_to').notNull().default('order'),
    targetIds: text('target_ids').array().notNull().default(sql`'{}'::text[]`),
    minQty: integer('min_qty'),
    minSubtotalPaise: integer('min_subtotal_paise'),
    customerEligibility: discountsEligibility('customer_eligibility').notNull().default('all'),
    segmentId: text('segment_id'),
    usageLimitTotal: integer('usage_limit_total'),
    usageLimitPerCustomer: integer('usage_limit_per_customer'),
    stackable: boolean('stackable').notNull().default(false),
    priority: integer('priority').notNull().default(0),
    descriptionPublic: text('description_public'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('discounts_rule_live_idx').on(t.status, t.startsAt, t.endsAt),
    index('discounts_rule_list_idx').on(t.createdAt.desc(), t.id.desc()),
    check('discounts_rule_value_ck', sql`${t.value} > 0 and (${t.valueType} = 'fixed' or ${t.value} <= 100)`),
    check('discounts_rule_window_ck', sql`${t.startsAt} is null or ${t.endsAt} is null or ${t.endsAt} > ${t.startsAt}`),
  ],
);

/** Codes of a `kind = code` rule, stored upper case. `single_use_phone_hash` pins a code to one customer, once. */
export const discountsCode = pgTable(
  'discounts_code',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => discountsRule.id, { onDelete: 'cascade' }),
    code: text('code').notNull().unique('discounts_code_code_uq'),
    singleUsePhoneHash: text('single_use_phone_hash'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('discounts_code_rule_idx').on(t.ruleId), check('discounts_code_upper_ck', sql`${t.code} = upper(${t.code}) and length(${t.code}) between 3 and 40`)],
);

/** One row per rule used on an order; written in the order's transaction, removed when the order is cancelled. */
export const discountsRedemption = pgTable(
  'discounts_redemption',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => discountsRule.id),
    codeId: uuid('code_id').references(() => discountsCode.id),
    orderId: uuid('order_id').notNull(),
    customerId: uuid('customer_id'),
    phoneHash: text('phone_hash'),
    amountPaise: integer('amount_paise').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('discounts_redemption_order_rule_uq').on(t.orderId, t.ruleId),
    index('discounts_redemption_rule_phone_idx').on(t.ruleId, t.phoneHash),
    index('discounts_redemption_code_idx').on(t.codeId),
    index('discounts_redemption_list_idx').on(t.createdAt.desc(), t.id.desc()),
  ],
);

export type DiscountRuleRow = typeof discountsRule.$inferSelect;
export type DiscountCodeRow = typeof discountsCode.$inferSelect;
export type DiscountRedemptionRow = typeof discountsRedemption.$inferSelect;
