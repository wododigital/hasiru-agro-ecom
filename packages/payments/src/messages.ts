/** Default buyer-facing copy for payments. Hosts override any key through their messages object. */
export const paymentsMessages = {
  methods: {
    online: 'Pay online (UPI, cards, net banking)',
    cod_partial: (advance: string) => `Pay ${advance} now, the rest on delivery`,
    bank_transfer: 'Bank transfer',
    pay_at_pickup: 'Pay when you collect',
  },
  return: {
    metaTitle: 'Payment status',
    paid: { title: 'Payment received', body: (amount: string) => `We have received ${amount}. Your order is confirmed.` },
    pending: {
      title: 'Confirming your payment',
      body: 'Your bank has not confirmed the payment yet. This page checks again in a few seconds. Please do not pay twice.',
    },
    failed: {
      title: 'Payment did not go through',
      body: 'Nothing was charged for this attempt. If your account was debited, your bank reverses it automatically.',
      expired: 'The time to pay for this order is over and it has been released. Please place the order again.',
    },
    review: {
      title: 'We are checking your payment',
      body: 'Your payment reached us after the order had closed. Our team will contact you and refund it if it cannot be used.',
    },
    notFound: { title: 'Payment not found', body: 'This link is not valid. Check your order from your account or the link in your messages.' },
    viewOrder: 'View your order',
    retry: 'Try paying again',
    refresh: 'Check again',
  },
};

export type PaymentsMessages = typeof paymentsMessages;
