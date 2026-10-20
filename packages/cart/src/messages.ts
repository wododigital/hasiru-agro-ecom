// Default storefront copy for the cart. A host overrides any key through configureCart({ messages }).
// Brand-neutral: store names and policies come from the host.

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n.toLocaleString('en-IN')} ${many}`);

export const cartMessages = {
  page: {
    title: 'Your cart',
    metaTitle: 'Cart',
    items: (n: number) => plural(n, 'item', 'items'),
    loading: 'Loading your cart',
  },
  empty: {
    title: 'Your cart is empty',
    body: 'Browse plants and inputs, or let us help you plan your land.',
    shop: 'Browse plants',
  },
  zones: {
    package: 'Recommended package',
    packageLand: (sqft: string) => `For ${sqft} sq ft of land`,
    additional: 'Additional items',
  },
  line: {
    remove: 'Remove',
    each: 'each',
    bulkAt: (minQty: number, toGo: number) => `Bulk at ${minQty.toLocaleString('en-IN')} (${toGo.toLocaleString('en-IN')} more)`,
    bulkPrice: (price: string) => `${price} each at bulk`,
    bulkReached: 'Bulk price applied',
    recommended: (n: number) => `Recommended ${n.toLocaleString('en-IN')}`,
    unavailable: 'No longer available. Remove it to continue.',
    outOfStock: 'Out of stock',
    short: (n: number) => `Only ${n.toLocaleString('en-IN')} available`,
  },
  inputs: {
    title: 'Recommended inputs for your plants',
    body: 'Add the inputs your plants need at planting.',
    cta: 'See inputs',
  },
  coupon: {
    label: 'Coupon code',
    placeholder: 'Enter code',
    apply: 'Apply',
    remove: 'Remove code',
    applied: (code: string) => `${code} applied`,
    notApplied: (code: string) => `${code} does not apply to this cart right now`,
    reasons: {
      invalid: 'This code is not valid.',
      rate_limited: 'Too many attempts. Try again in a few minutes.',
      limit_reached: 'This code has reached its limit.',
      not_eligible: 'This code is not available for your account.',
      no_matching_items: 'This code does not apply to the items in your cart.',
      min_qty: 'Add more items to use this code.',
      min_subtotal: 'Add more to your cart to use this code.',
      not_stackable: 'This code cannot be combined with the current offer.',
      empty: 'Add items before applying a code.',
      unavailable: 'Codes are not available right now.',
    } as Record<string, string>,
  },
  delivery: {
    title: 'Delivery',
    choose: 'Choose how you want it delivered',
    pickup: 'Pick up at the nursery',
    local_slot: 'Local delivery',
    outstation: 'Outstation delivery',
    enquiry_only: 'Delivery on enquiry',
    free: 'Free',
    on: (date: string) => `On ${date}`,
    between: (from: string, to: string) => `${from} to ${to}`,
    vehicle: (label: string, trips: number) => (trips > 1 ? `${label}, ${trips} trips` : label),
    unavailable: 'Not available for your area',
    save: 'Use this option',
    later: 'Delivery is calculated at checkout',
  },
  summary: {
    title: 'Order summary',
    subtotal: 'Subtotal',
    tierSavings: 'Bulk savings',
    promo: (label: string) => label,
    coupon: (code: string) => `Coupon ${code}`,
    packing: 'Packing',
    transport: 'Transport',
    gstIncluded: (amount: string) => `Includes GST of ${amount} on inputs`,
    total: 'Total',
    noReturns: 'No cancellation or return on this order.',
    proceed: (amount: string) => `Proceed to pay ${amount}`,
  },
  notices: {
    unknown_variant: 'That item is no longer available.',
    not_purchasable: 'That item cannot be added right now.',
    too_many_lines: 'Your cart is full. Remove something first.',
    rate_limited: 'Too many carts from this connection. Try again later.',
    restore_invalid: 'That cart link is not valid.',
    restore_expired: 'That cart link has expired.',
    restore_gone: 'That cart has already been ordered or cleared.',
    restore_used: 'That cart link has already been used. Your cart is still here.',
  } as Record<string, string>,
  restore: {
    title: 'Your cart is ready',
    items: (n: number) => plural(n, 'item is waiting for you', 'items are waiting for you'),
    signIn: 'Sign in to open this cart.',
    open: 'Open my cart',
    back: 'Back to the shop',
  },
  drawer: {
    open: 'Open cart',
    title: 'Cart',
    count: (n: number) => plural(n, 'item', 'items'),
    viewCart: 'View cart',
    total: 'Total',
    empty: 'Your cart is empty.',
    checkout: 'Checkout',
    loading: 'Loading',
    error: 'Could not load your cart. Try again.',
  },
};

export type CartMessages = typeof cartMessages;
export type CartMessagesOverride = { [K in keyof CartMessages]?: Partial<CartMessages[K]> };

export function mergeMessages(override: CartMessagesOverride | undefined): CartMessages {
  if (!override) return cartMessages;
  const out: Record<string, unknown> = { ...cartMessages };
  for (const [section, value] of Object.entries(override)) {
    const base = (cartMessages as Record<string, unknown>)[section];
    out[section] = base && typeof base === 'object' && value && typeof value === 'object' ? { ...base, ...value } : value;
  }
  return out as CartMessages;
}
