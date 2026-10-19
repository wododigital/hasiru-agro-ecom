/**
 * Default copy for the primitives (mostly accessible names). A host overrides per component through
 * the `labels` prop, usually from its own messages object (apps/shop/messages/en.ts `ui`).
 */
export const uiMessages = {
  common: {
    close: 'Close',
    loading: 'Loading',
    remove: 'Remove',
  },
  qty: {
    add: 'Add',
    decrease: 'Decrease quantity',
    increase: 'Increase quantity',
    quantity: 'Quantity',
    addMany: (n: number) => `Add ${n} more`,
  },
  rail: {
    previous: 'Scroll back',
    next: 'Scroll forward',
  },
  price: {
    was: 'Was',
    now: 'Now',
  },
  rating: {
    newChip: 'New',
    summary: (average: number, count: number) => `Rated ${average.toFixed(1)} out of 5 from ${count} reviews`,
  },
  breadcrumbs: {
    label: 'Breadcrumb',
  },
  image: {
    fallback: 'Image coming soon',
  },
  secret: {
    replace: 'Replace',
    cancel: 'Keep current',
    show: 'Show value',
    hide: 'Hide value',
    notSet: 'Not set',
  },
  dateRange: {
    from: 'From',
    to: 'To',
  },
  table: {
    search: 'Search',
    all: 'All',
    sortAsc: 'sorted ascending',
    sortDesc: 'sorted descending',
    previous: 'Previous page',
    next: 'Next page',
    pageOf: (page: number, pages: number) => `Page ${page} of ${pages}`,
    empty: 'Nothing here yet',
  },
};

export type UiMessages = typeof uiMessages;
