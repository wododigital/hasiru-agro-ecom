/** Default storefront copy for coupon entry and promo lines. Hosts override through their messages object. */
export const discountsMessages = {
  coupon: {
    label: 'Coupon code',
    apply: 'Apply',
    remove: 'Remove',
    applied: 'Code {code} applied',
    invalid: 'This code is not valid',
    rate_limited: 'Too many attempts. Please try again in a few minutes',
    limit_reached: 'This code has already been used up',
    not_eligible: 'This code is not available for your account',
    no_matching_items: 'This code does not apply to the items in your cart',
    /** `{more}` = items still needed. */
    min_qty: 'Add {more} more items to use this code',
    /** `{more}` = formatted amount still needed. */
    min_subtotal: 'Add {more} more to use this code',
    not_stackable: 'This code cannot be combined with the current offer, so the better saving is applied',
  },
} as const;

export type DiscountsMessages = typeof discountsMessages;
