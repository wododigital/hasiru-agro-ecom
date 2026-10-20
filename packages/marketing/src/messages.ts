/** Default storefront copy for the consent banner. Hosts override through their messages object. */
export const marketingMessages = {
  consent: {
    title: 'Cookies on this site',
    body: 'We use essential cookies to run the store. With your permission we also use analytics cookies to improve it and advertising cookies to measure our ads. You can change this at any time from the link in the footer.',
    acceptAll: 'Accept all',
    rejectAll: 'Only essential',
    customise: 'Choose',
    save: 'Save choices',
    analytics: 'Analytics',
    analyticsHelp: 'Counts visits and how the store is used.',
    marketing: 'Advertising',
    marketingHelp: 'Measures which ads bring visitors and lets us show relevant ads.',
    essential: 'Essential',
    essentialHelp: 'Cart, sign-in and checkout. Always on.',
    dialogLabel: 'Cookie choices',
    error: 'Your choice could not be saved. Please try again.',
    reopen: 'Cookie settings',
  },
};
export type MarketingMessages = typeof marketingMessages;

/** The exact text recorded with a consent row (the banner body plus a version tag). */
export const consentTextShown = (m: MarketingMessages['consent'] = marketingMessages.consent) => `${m.body} [banner-2026-10]`;
