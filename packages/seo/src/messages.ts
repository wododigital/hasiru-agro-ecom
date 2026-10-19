/** Default storefront copy for the seo module. Hosts override through `configureSeo({ messages })`. */
export const seoMessages = {
  notFound: {
    title: 'Page not found',
    body: 'The page you were looking for has moved or no longer exists.',
    searchLabel: 'Search the store',
    searchPlaceholder: 'What are you looking for?',
    searchButton: 'Search',
    linksHeading: 'Popular places to start',
    home: 'Go to the home page',
  },
  llms: {
    pagesHeading: 'Pages',
  },
};

export type SeoMessages = typeof seoMessages;
export type SeoMessagesOverride = { [K in keyof SeoMessages]?: Partial<SeoMessages[K]> };

export function mergeSeoMessages(override: SeoMessagesOverride = {}): SeoMessages {
  return {
    notFound: { ...seoMessages.notFound, ...override.notFound },
    llms: { ...seoMessages.llms, ...override.llms },
  };
}
