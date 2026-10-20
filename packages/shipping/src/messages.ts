// Default storefront copy for shipping. The host app overrides any key through its own messages.
import type { ShippingMethodKind } from '@ecomkit/core/contracts';

export const shippingMessages = {
  methods: {
    pickup: 'Pick up from us',
    local_slot: 'Local scheduled delivery',
    outstation: 'Outstation delivery',
    enquiry_only: 'Delivery on request',
  } satisfies Record<ShippingMethodKind, string>,
  reasons: {
    'shipping.address_needed': 'Add your delivery address to see this option.',
    'shipping.outside_local_zone': 'Not available for this address.',
    'shipping.use_local': 'Your address gets local scheduled delivery instead.',
    'shipping.enquiry_only': 'We deliver here on request. Send us an enquiry and we will quote.',
    'shipping.distance_unknown': 'We will confirm the distance and charge for this place.',
    'shipping.no_slots': 'No delivery days are open right now.',
    'shipping.no_vehicle': 'Delivery is not set up yet.',
  } as Record<string, string>,
  check: {
    title: 'Check delivery',
    pincode: 'Pincode',
    placeholder: '6-digit pincode',
    submit: 'Check',
    checking: 'Checking',
    invalid: 'Enter a 6-digit pincode.',
    unknown: 'We could not find that pincode.',
    lookupOff: 'Pincode lookup is not available. You can choose your district at checkout.',
    failed: 'That did not go through. Please try again.',
    free: 'Free',
    // Plain strings with {placeholders}: this group is passed to a client island.
    readyOn: 'Ready on {date}',
    deliveredOn: 'Delivery on {date}',
    deliveredBetween: 'Delivery between {from} and {to}',
    distance: '{km} km away',
  },
};
export type ShippingMessages = typeof shippingMessages;
