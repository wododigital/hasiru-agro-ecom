import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { shippingMessages } from '../src/messages';
import { DeliveryCheckSection } from '../src/ui';

describe('PDP delivery check', () => {
  it('renders the pincode form with a tracked CTA and host copy overrides', () => {
    const html = renderToStaticMarkup(DeliveryCheckSection({ productId: 'p', slug: 's' }));
    expect(html).toContain(shippingMessages.check.title);
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('data-cta="pdp-delivery-check"');
    const custom = renderToStaticMarkup(DeliveryCheckSection({ productId: 'p', slug: 's', messages: { ...shippingMessages, check: { ...shippingMessages.check, title: 'Delivery to your farm' } } }));
    expect(custom).toContain('Delivery to your farm');
  });
});
