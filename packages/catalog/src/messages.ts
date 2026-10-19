// Default storefront copy for the catalog. A host overrides any key through configureCatalog({ messages }).
// Brand-neutral: store names, claims and contact details come from the host or settings.

const yrs = (min: number | null, max: number | null) => (min != null && max != null && max !== min ? `${min} to ${max} yrs` : `${min ?? max} yrs`);

export const catalogMessages = {
  nav: {
    plants: 'Plants',
    inputs: 'Inputs',
    home: 'Home',
  },
  listing: {
    allPlants: 'All plants',
    allInputs: 'Farm inputs',
    plantsIntro: 'Saplings for farms, food forests and gardens, grown and packed for delivery.',
    inputsIntro: 'Compost, biochar, seeds and other inputs for healthy planting.',
    count: (n: number) => (n === 1 ? '1 product' : `${n} products`),
    helpMeChoose: 'Help me choose',
    inStockOnly: 'In stock only',
    sort: 'Sort',
    sortOptions: { featured: 'Featured', price_asc: 'Price: low to high', price_desc: 'Price: high to low', name: 'Name', newest: 'Newest' },
    apply: 'Apply',
    empty: 'Nothing matches here yet.',
    emptyBody: 'Try another collection or ask us for help choosing.',
    previous: 'Previous',
    next: 'Next',
    pageOf: (page: number, pages: number) => `Page ${page} of ${pages}`,
    subcollections: 'Browse by type',
  },
  card: {
    outOfStock: 'Out of stock',
    bulkUnlocked: 'Bulk price unlocked',
    fitsDistrict: 'Fits your district',
    bestseller: 'Bestseller',
    newArrival: 'New',
    save: (amount: string) => `Save ${amount}`,
    bulkFrom: (amount: string, qty: number) => `${amount} each from ${qty} plants`,
    onlyLeft: (n: number) => `Only ${n} left`,
    inStock: 'In stock',
    preorder: (days: number | null) => (days ? `Ready in about ${days} days` : 'Available to pre-order'),
    comingSoon: 'Coming soon',
    unavailable: 'Temporarily unavailable',
    notifyMe: 'Notify me',
    sizeClass: { L: 'Large tree', M: 'Medium tree', S: 'Small plant' } as Record<string, string>,
    fitGood: 'Good fit',
    fitOk: 'Needs irrigation',
    fruitsIn: (min: number | null, max: number | null) => `Fruits in ${yrs(min, max)}`,
    harvestIn: (years: number) => `Harvest in ${years} yrs`,
    yieldLabel: (text: string) => `Yield ${text}`,
    view: (name: string) => `View ${name}`,
  },
  pdp: {
    addToCart: 'Add to cart',
    buyNow: 'Buy now',
    askWhatsApp: 'Ask on WhatsApp',
    whatsAppText: (name: string, url: string) => `Hi, I would like to know more about ${name}: ${url}`,
    quantity: 'Quantity',
    variant: 'Size',
    tiersTitle: 'Bulk pricing',
    tierRow: (minQty: number) => `${minQty}+ plants`,
    tierBase: (maxQty: number) => `1 to ${maxQty}`,
    perUnit: 'each',
    nudge: (more: number, unit: string, save: string) => `Add ${more} more to unlock ${unit} each, save ${save}`,
    needMore: 'Need a larger quantity? Ask us for a quote.',
    gallery: 'Product images',
    imageCredit: (credit: string) => `Photo: ${credit}`,
    keyFacts: 'Key facts',
    care: 'Care guide',
    description: 'About this plant',
    faq: 'Questions and answers',
    related: 'Grows well with',
    recentlyViewed: 'Recently viewed',
    noReturns: 'Live plants cannot be returned. Anything damaged in transit is replaced.',
    trust: ['Grown and checked at our nursery', 'Packed for safe transport', 'Damage replaced'],
    fitTitle: 'Will it grow in your district?',
    fitPrompt: 'Tell us your district to check how this plant suits your climate.',
    fitChoose: 'Find plants for my land',
    fitLevel: {
      good: (district: string) => `Grows well in ${district}`,
      ok: (district: string) => `Grows in ${district} with irrigation`,
      not_recommended: (district: string) => `Not recommended for ${district}`,
    },
    fitReasons: {
      'fit.too_dry': 'Rainfall there is below what this plant needs.',
      'fit.too_wet': 'Rainfall there is above what this plant likes.',
      'fit.too_hot': 'Summers there are hotter than this plant tolerates.',
      'fit.too_cold': 'Winters there are colder than this plant tolerates.',
      'fit.humidity': 'Humidity there is outside its comfortable range.',
      'fit.ok': 'Regular watering helps it establish.',
      'fit.not_recommended': 'The local climate is outside its range.',
    } as Record<string, string>,
    notifyTitle: 'Get a message when it is back',
    notifyPhone: 'Mobile number',
    notifyEmail: 'Email (optional)',
    notifyConsent: 'Message me once when this is back in stock.',
    notifySubmit: 'Notify me',
    stickyAdd: 'Add',
    facts: {
      scientificName: 'Scientific name',
      sizeClass: 'Tree size',
      matureHeight: 'Mature height',
      bearing: 'Starts fruiting',
      rotation: 'Timber harvest',
      yield: 'Yield',
      harvestSeason: 'Harvest season',
      exposure: 'Sunlight',
      water: 'Water need',
      drought: 'Drought tolerance',
      temperature: 'Temperature range',
      rainfall: 'Rainfall',
      propagation: 'Propagation',
      nitrogenFixer: 'Fixes nitrogen',
      spacing: 'Spacing',
      dispatchHeight: 'Height at dispatch',
      bagSize: 'Bag size',
      packSize: 'Pack size',
    },
    units: {
      ft: (min: number | null, max: number | null) => (min != null && max != null && min !== max ? `${min} to ${max} ft` : `${min ?? max} ft`),
      years: yrs,
      celsius: (min: number, max: number) => `${min} to ${max} °C`,
      rainfall: (min: number, max: number) => `${min} to ${max} mm a year`,
      spacing: (l: number, w: number) => `${l} x ${w} ft`,
      yes: 'Yes',
    },
    enums: {
      exposure: { full_sun: 'Full sun', partial_shade: 'Partial shade', shade: 'Shade' } as Record<string, string>,
      level: { low: 'Low', moderate: 'Moderate', high: 'High', medium: 'Medium' } as Record<string, string>,
      propagation: {
        seeded: 'Seedling',
        grafted: 'Grafted',
        air_layered: 'Air layered',
        cuttings: 'Cutting',
        suckers: 'Sucker',
        tissue_culture: 'Tissue culture',
        other: 'Other',
      } as Record<string, string>,
      model: { food_forest: 'Food forest', miyawaki: 'Miyawaki', commercial: 'Commercial', boundary: 'Boundary' } as Record<string, string>,
    },
  },
};

export type CatalogMessages = typeof catalogMessages;

type DeepPartial<T> = { [K in keyof T]?: T[K] extends (...a: never[]) => unknown ? T[K] : T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type CatalogMessagesOverride = DeepPartial<CatalogMessages>;

/** Default copy with a host override merged in, one level of nesting deep per section. */
export function mergeMessages(override: CatalogMessagesOverride | undefined): CatalogMessages {
  if (!override) return catalogMessages;
  const out: Record<string, unknown> = { ...catalogMessages };
  for (const [section, value] of Object.entries(override)) {
    const base = (catalogMessages as Record<string, unknown>)[section];
    out[section] = base && typeof base === 'object' && value && typeof value === 'object' ? { ...base, ...value } : value;
  }
  return out as CatalogMessages;
}
