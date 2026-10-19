/** Default storefront copy for price displays. Hosts override through their messages object. */
export const pricingMessages = {
  each: 'each',
  bulkPrice: 'bulk price',
  /** `{qty}` = threshold, `{more}` = units still needed. */
  bulkAt: 'bulk at {qty} ({more} more)',
  bulkFrom: 'bulk from {qty}',
} as const;

export type PricingMessages = typeof pricingMessages;
