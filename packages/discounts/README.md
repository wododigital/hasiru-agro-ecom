# @ecomkit/discounts

Automatic promotions, coupon codes, eligibility, date windows (IST), usage limits, atomic redemptions and the A8 stacking selection.

## How a discount is decided

1. Bulk tiers give the unit price (pricing). Discounts always work on the tier price.
2. `applicablePromos(cart)` returns every stackable automatic promo that applies plus the single best non-stackable one (largest amount, then priority, then id).
3. `applyCoupon(code, cart, { subject })` checks one code (one coupon per order).
4. `core.computeTotals` makes the coupon-versus-promo decision once: a coupon combines only with stackable promos; otherwise the larger side wins (best-of) and the loser is reported in `rejectedDiscounts`.
5. `redeem(...)` records the uses inside the order transaction.

## Public API

| Export | What |
|---|---|
| `@ecomkit/discounts/domain` | `evaluate(rule, cart, now)`, `selectPromos(rules, cart, now)`, `windowState`, `targetLines`, `allocate`, `normaliseCode`, `generateCodes`, `istLocalToDate`, `toIstLocal`, `ruleInputSchema`, `ruleFormSchema`, types `DiscountRule`, `DiscountCart`, `DiscountCartLine`, `DiscountCustomer`. Pure. |
| `@ecomkit/discounts/server` | `applicablePromos(cart, { now })`, `applyCoupon(code, cart, { subject, phone?, customerId?, now? })`, `redeem(input, { tx, now? })`, `RedemptionError`, `releaseRedemptions(orderId)`, `listRules()`, `getRule(id)`, `saveRule(input, actor)`, `addCodes(ruleId, codes, actor, { singleUsePhone?, expiresAt? })`, `createSingleUseCode({ ruleId, phone, expiresAt?, prefix? })`, `hashPhone`, `COUPON_ATTEMPT_LIMIT`, `COUPON_ATTEMPT_WINDOW_SEC`. |
| `@ecomkit/discounts/admin` | `DiscountsListPage`, `DiscountEditPage`, `saveRuleAction`, `addCodesAction`. |
| `@ecomkit/discounts/messages` | `discountsMessages.coupon.*` (one string per `applyCoupon` reason). |

Cart input: lines priced at the tier unit (`unitPaise`), with `productId`, optional `collectionIds` and `tagIds` (the caller fills them from catalog), and the customer (`isFirstOrder`, `segmentIds`) or null for guests.

Coupon answers: `invalid` for unknown, expired, paused or someone else's personal code (guessing learns nothing); `rate_limited` after 10 attempts per subject per 15 minutes (counted before any lookup); `limit_reached`; `not_eligible`; `no_matching_items`; `min_qty` / `min_subtotal` with `shortBy`.

Redemption: locks the rule rows (`FOR UPDATE`, id order) and checks total, per-customer (by phone hash or customer id) and single-use code limits under the lock; throws `RedemptionError` with `limit_reached`, `customer_limit_reached`, `code_used`, `not_live` or `invalid`. Idempotent per `(order_id, rule_id)`.

Dates: windows are instants (`timestamptz`); the admin enters India time in `datetime-local` fields. Starts inclusive, ends exclusive.

## Tables

- `discounts_rule` (name, kind automatic|code, status draft|active|paused|archived, starts_at, ends_at, value_type percent|fixed, value, applies_to order|collection|products|tags, target_ids, min_qty, min_subtotal_paise, customer_eligibility all|segment|first_order, segment_id, usage limits, stackable, priority, description_public).
- `discounts_code` (rule_id, code unique upper case, single_use_phone_hash, expires_at).
- `discounts_redemption` (rule_id, code_id, order_id, customer_id, phone_hash, amount_paise), unique `(order_id, rule_id)`.

## Admin

Nav "Discounts" (Marketing band, order 410, `marketing.write`). Pages `/admin/discounts`, `/admin/discounts/new`, `/admin/discounts/[id]` (rule form, codes: paste or generate). Every create/update and code batch is written to `core_audit_log`; saves expire the `promo:active` cache tag.

## Events

Consumes `order.cancelled` and `order.payment_failed`: the order's redemptions are deleted so limits count only real orders. Emits nothing.

## Disable

Remove `discounts` from `modules.config.ts`. Cart and checkout treat it as optional (`registry.has('discounts')`): no promo lines, no coupon field.
