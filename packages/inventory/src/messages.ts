// Default storefront copy for the inventory module. The host app overrides any key through its own messages.
export const inventoryMessages = {
  notifyMe: {
    title: 'Out of stock right now',
    body: 'Leave a mobile number or email and we will message you once when it is back.',
    phone: 'Mobile number',
    email: 'Email',
    consent: 'Message me once when this is back in stock',
    submit: 'Notify me',
    sending: 'Saving',
    done: 'Saved. We will message you when it is back.',
    invalid: 'Enter a valid mobile number or email.',
    rateLimited: 'Too many tries. Please try again in a while.',
    failed: 'That did not go through. Please try again.',
  },
  preorder: (days: number) => `Ready to dispatch in about ${days} days`,
} as const;
export type InventoryMessages = typeof inventoryMessages;
