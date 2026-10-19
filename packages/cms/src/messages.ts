/** Default storefront copy for cms pages and blocks. Hosts override through `configureCms({ messages })`. */
export const cmsMessages = {
  breadcrumbs: { home: 'Home', guides: 'Guides', videos: 'Videos', policies: 'Policies' },
  guides: {
    title: 'Guides',
    description: 'Practical guides and how-tos.',
    empty: 'No guides published yet.',
    readMore: 'Read the guide',
    by: 'By',
    published: 'Published',
  },
  videos: {
    title: 'Videos',
    description: 'Watch how it is done.',
    empty: 'No videos published yet.',
    other: 'More videos',
    watch: { youtube: 'Watch on YouTube', whatsapp: 'Watch on WhatsApp', file: 'Play video' },
    /** Read after the link text by screen readers. */
    opensNewTab: ', opens in a new tab',
  },
  blocks: {
    testimonialsHeading: 'What our customers say',
    trustHeading: 'Trusted by',
    countersHeading: 'Our results',
    teamHeading: 'Our team',
    galleryHeading: 'Gallery',
    faqHeading: 'Frequently asked questions',
    galleryImage: 'Gallery image',
  },
  page: { lastUpdated: 'Last updated' },
};

export type CmsMessages = typeof cmsMessages;
export type CmsMessagesOverride = { [K in keyof CmsMessages]?: Partial<CmsMessages[K]> };

export function mergeCmsMessages(override: CmsMessagesOverride = {}): CmsMessages {
  return Object.fromEntries(Object.entries(cmsMessages).map(([k, v]) => [k, { ...v, ...(override[k as keyof CmsMessages] ?? {}) }])) as CmsMessages;
}
