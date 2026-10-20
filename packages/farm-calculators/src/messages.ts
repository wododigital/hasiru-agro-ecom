// Default storefront copy for the farm calculators. Brand-neutral; the host overrides keys through configureFarmCalculators.
export const farmCalculatorsMessages = {
  plant: {
    pageTitle: 'Plant calculator',
    pageLead: 'Find out how many plants fit your land, at the spacing each plant needs.',
    metaTitle: 'Plant calculator: how many plants per acre',
    metaDescription: 'Work out how many plants fit your land for any spacing, in a square or triangular layout, and add them to your cart.',
    plantLabel: 'Plant (fills its recommended spacing)',
    customSpacing: 'Custom spacing',
    plantOption: '{name} ({l} x {w} ft)',
    areaLabel: 'Land area',
    unitLabel: 'Area unit',
    acre: 'Acre',
    sqft: 'Sq ft',
    lengthLabel: 'Plant to plant (ft)',
    widthLabel: 'Row to row (ft)',
    layoutLabel: 'Layout',
    square: 'Square',
    triangular: 'Triangular',
    buffer: 'Add 3% extra for gap filling',
    resultLead: 'You can plant about',
    plantsWord: 'plants',
    perAcre: 'Plants per acre',
    spacing: 'Spacing',
    spacingValue: '{l} x {w} ft, {layout}',
    price: 'Price for this quantity',
    each: '{price} each',
    bulkApplies: 'Bulk price applies',
    bulkFrom: 'Bulk price from {qty} plants ({more} more)',
    pickToAdd: 'Pick a plant to add',
    add: 'Add {count} to cart',
    added: '{count} x {name} added to your cart',
    addFailed: 'Could not add to the cart. Please try again.',
    formula: 'Formula: 43,560 sq ft per acre / (plant spacing x row spacing). A triangular layout fits about 15% more.',
    openButton: 'Plant calculator',
    modalTitle: 'How many plants do I need?',
    loading: 'Loading plants',
    loadFailed: 'The calculator could not load. Please try again.',
    retry: 'Try again',
  },
  compost: {
    pageTitle: 'Compost and input calculator',
    pageLead: 'How much compost and soil input your plants need at planting, rounded up to full packs.',
    metaTitle: 'Compost calculator: vermicompost and biochar per plant',
    metaDescription: 'Work out how much vermicompost, biochar and other inputs your plants need, in full packs, and add them to your cart.',
    modeLabel: 'Count plants from',
    modeCart: 'Plants in my cart',
    modeManual: 'Enter my own',
    cartEmpty: 'Your cart has no plants yet, so enter your own counts.',
    sizes: { L: 'Large trees', M: 'Medium trees', S: 'Small plants' },
    sizeCount: '{label} count',
    resultLead: 'Recommended for {plants} plants',
    packs: '{packs} x {pack}',
    amount: '{amount} {unit}',
    nothing: 'Enter a plant count to see what you need.',
    addPack: 'Add recommended pack',
    added: 'Recommended pack added to your cart',
    addFailed: 'Could not add to the cart. Please try again.',
    note: 'Amounts follow our dosage guide per plant type and are rounded up to full packs. Adding the pack adds to what is already in your cart.',
    unavailable: 'The input calculator is being set up. Please check back soon.',
  },
};

export type FarmCalculatorsMessages = typeof farmCalculatorsMessages;
export type FarmCalculatorsMessagesOverride = { [K in keyof FarmCalculatorsMessages]?: Partial<FarmCalculatorsMessages[K]> };

/** Section-wise merge of host overrides over the defaults. */
export function mergeMessages(override: FarmCalculatorsMessagesOverride = {}): FarmCalculatorsMessages {
  const out = { ...farmCalculatorsMessages } as Record<string, unknown>;
  for (const [k, v] of Object.entries(override)) out[k] = { ...(out[k] as object), ...(v as object) };
  return out as FarmCalculatorsMessages;
}

/** Fills `{name}` placeholders; numbers get en-IN grouping. Templates stay plain strings so islands receive them as props. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (all, key: string) => {
    const v = values[key];
    return v === undefined ? all : typeof v === 'number' ? v.toLocaleString('en-IN') : v;
  });
}
