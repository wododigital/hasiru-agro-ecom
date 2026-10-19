import type { UiMessages } from '@ecomkit/ui/messages';

/**
 * Every storefront string of the Hasiru Agro store (en-IN). Module packages ship default copy in their own
 * `messages.ts`; this object holds the shell copy and the host overrides, keyed by module id. Kannada later
 * adds messages/kn.ts with the same shape. Rules: no em dashes; "Rs" with en-IN grouping comes from formatINR.
 */

/** Partial overrides of a module's default messages (nested one level). */
type Overrides<T> = { [K in keyof T]?: Partial<T[K]> };

const ui: Overrides<UiMessages> = {
  image: { fallback: 'Photo coming soon' },
};

export const messages = {
  brand: {
    name: 'Hasiru Agro',
    homeLabel: 'Hasiru Agro home',
  },
  shell: {
    skipToContent: 'Skip to content',
    nav: {
      label: 'Main',
      plants: 'Plants',
      helpMeChoose: 'Help me choose',
      farmDevelopment: 'Farm development',
      inputs: 'Farm inputs',
      guides: 'Guides',
    },
    askAi: 'Ask AI',
    askAiLabel: 'Ask our plant expert',
    cart: 'Cart',
    cartLabel: (qty: number) => (qty === 1 ? 'Cart, 1 item' : `Cart, ${qty} items`),
    account: 'Account',
    menu: 'Menu',
    openMenu: 'Open menu',
    cartBar: {
      items: (qty: number) => (qty === 1 ? '1 item' : `${qty} items`),
      viewCart: 'View cart',
    },
    footer: {
      shop: 'Shop',
      company: 'Company',
      help: 'Help',
      policies: 'Policies',
      visit: 'Visit the nursery',
      hours: 'Hours',
      whatsapp: 'Chat on WhatsApp',
      consentSettings: 'Cookie and tracking settings',
      rights: (year: number) => `© ${year} Hasiru Agro. All rights reserved.`,
    },
    consent: {
      title: 'Your privacy',
      body: 'We use analytics and ads cookies only if you allow them. The store works either way.',
      accept: 'Accept',
      reject: 'Reject',
    },
    notFound: {
      title: 'We could not find that page',
      body: 'The link may be old or mistyped. Try a search or browse a collection.',
      search: 'Search plants',
      browse: 'Browse all plants',
    },
    error: {
      title: 'Something went wrong',
      body: 'Please try again. If it keeps happening, call or WhatsApp us.',
      retry: 'Try again',
    },
  },
  home: {
    hero: {
      eyebrow: 'Nursery to farm, Bengaluru',
      titleBefore: 'Healthy saplings for ',
      titleAccent: 'farm-scale',
      titleAfter: ' planting',
      lead: 'Grafted fruit trees, timber and plantation crops from our own nursery. Bulk prices, farm inputs and delivery across Karnataka.',
    },
    paths: {
      shop: { title: 'I know what I want', body: 'Browse 190+ plants, add quantities and unlock bulk prices.', cta: 'Shop plants' },
      choose: { title: 'Help me choose', body: 'Tell us your location, land size and purpose. Get a planting plan and package.', cta: 'Start in 3 steps' },
    },
    bestSellers: { eyebrow: 'Best sellers', title: 'Most planted this season', viewAll: 'View All Plants' },
    calculator: { eyebrow: 'Plant calculator', title: 'How many plants fit your land?' },
    inputs: { eyebrow: 'Farm inputs', title: 'Feed the soil, not just the plant', compostLink: 'Compost calculator' },
    compost: { eyebrow: 'Compost calculator', title: 'How much compost do your plants need?' },
    videos: { eyebrow: 'Learn how', title: 'Planting the right way' },
  },
  /** Host overrides for module default copy, keyed by module id. Modules merge these over their own messages.ts. */
  ui,
} as const;

export type Messages = typeof messages;
