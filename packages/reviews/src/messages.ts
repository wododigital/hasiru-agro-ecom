/** Default storefront copy for reviews. Hosts override any key through their messages object. */
export const reviewsMessages = {
  section: {
    title: 'Customer reviews',
    empty: 'No reviews yet. Bought this? Tell other growers how it is doing.',
    write: 'Write a review',
    verified: 'Verified buyer',
    reply: 'Reply from the nursery',
    from: (name: string | null, district: string | null) => [name ?? 'A customer', district].filter(Boolean).join(', '),
    countLabel: (n: number) => (n === 1 ? '1 review' : `${n} reviews`),
    photoAlt: 'Photo shared by the reviewer',
    /** One review's stars (the summary line uses the ui Rating copy). */
    stars: (rating: number) => `Rated ${rating} out of 5`,
  },
  account: {
    title: 'Your reviews',
    intro: 'Reviews are checked by our team before they appear on the plant page.',
    empty: 'You have not reviewed anything yet.',
    writeTitle: 'Write a review',
    editTitle: 'Edit your review',
    product: 'Product',
    rating: 'Your rating',
    ratingOption: (n: number) => (n === 1 ? '1 star' : `${n} stars`),
    reviewTitle: 'Headline',
    body: 'Your review',
    bodyHelp: 'How did it arrive, and how is it growing?',
    district: 'Your district',
    photos: 'Photos',
    photosHelp: 'Up to 4 photos (JPG, PNG, WebP or HEIC), 8 MB each.',
    submit: 'Submit review',
    save: 'Save changes',
    edit: 'Edit',
    delete: 'Delete',
    status: { pending: 'Waiting for approval', approved: 'Published', rejected: 'Not published' },
  },
  outcome: {
    sent: 'Thank you. Your review will appear once our team has checked it.',
    saved: 'Saved. Your review is back with our team for a quick check.',
    deleted: 'Your review was deleted.',
    invalid: 'Please pick a rating and write at least a sentence.',
    already_reviewed: 'You have already reviewed this product. You can edit your review below.',
    rate_limited: 'You have sent many reviews today. Please try again tomorrow.',
    photos: 'Please add up to 4 photos (JPG, PNG, WebP or HEIC), 8 MB each.',
    photos_unavailable: 'Photos cannot be added right now. Please send your review without them.',
    not_found: 'That review was not found.',
  },
};

export type ReviewsMessages = typeof reviewsMessages;
export type ReviewOutcome = keyof ReviewsMessages['outcome'];
