// Boot wiring of the proof store: binds the ports of the modules it enables (no discounts, shipping, monitoring,
// notifications). Called from instrumentation `register()` and seed:load. Idempotent per process.
import { checkoutCart, configureCart, currentCartContext, markConverted } from '@ecomkit/cart/server';
import { configureCatalog, gstRatesFor, variantFacts, variantsOf } from '@ecomkit/catalog/server';
import { configureCheckout } from '@ecomkit/checkout/server';
import { setAuthProvider } from '@ecomkit/core/auth-context';
import { loadEnv } from '@ecomkit/core/env';
import { getSettings } from '@ecomkit/core/settings';
import { imageRefs, masterAssetIds } from '@ecomkit/media/server';
import { configureOrders, createOrder, guestTokenFor, orderForBuyer, ordersSettings, paymentsOrdersPort } from '@ecomkit/orders/server';
import { configurePayments, createPayment, loadSettings as paymentSettings } from '@ecomkit/payments/server';
import { configurePricing } from '@ecomkit/pricing/server';
import { copy } from '../messages';
import { registry } from './generated/registry';

const KEY = Symbol.for('minimal.booted');
type Holder = { [KEY]?: boolean };

export async function boot(options: { mediaDir?: string } = {}): Promise<void> {
  const g = globalThis as Holder;
  if (g[KEY] && !options.mediaDir) return;
  g[KEY] = true;
  const env = loadEnv();
  // auth and seo server code needs Next's server React build: bound only inside the Next server (not seed:load).
  const [auth, seo] = process.env.NEXT_RUNTIME === 'nodejs' ? await Promise.all([import('@ecomkit/auth/server'), import('@ecomkit/seo/server')]) : [null, null];

  setAuthProvider(() => registry.service('auth'));
  auth?.configureAuth({ appName: copy.brand });
  seo?.configureSeo({ site: { url: env.SITE_URL ?? 'http://localhost:3100', name: copy.brand, description: copy.tagline }, registry });
  configureCatalog({ registry, images: imageRefs, resolveMediaIds: options.mediaDir ? (srcs) => masterAssetIds(srcs, options.mediaDir!) : null, jsonLd: seo?.jsonLd() ?? null, metadata: seo?.buildMetadata ?? null });
  configurePricing({ gstRates: gstRatesFor, variantsOf });
  configureCart({ variants: variantFacts, registry });
  configureCheckout({
    cart: {
      current: async () => checkoutCart(await currentCartContext()),
      markConverted: async (cartId, orderId, o) => void (await markConverted(cartId, orderId, o)),
    },
    orders: {
      createOrder: (input, o) => createOrder(input as Parameters<typeof createOrder>[0], o),
      guestToken: guestTokenFor,
      sellerStateCode: async () => (await getSettings(ordersSettings)).sellerStateCode,
      forBuyer: async (id, token) => {
        const o = await orderForBuyer(id, token);
        return o ? { id: o.id, number: o.number, status: o.status, totalPaise: o.totalPaise, advancePaise: o.advancePaise, paidPaise: o.paidPaise, contact: o.contact as { name: string; phone: string | null; email: string | null } } : null;
      },
    },
    payments: {
      config: async () => {
        const s = await paymentSettings();
        return { codMode: s.codMode, advancePct: s.advancePercent, attemptExpiryMinutes: s.attemptExpiryMinutes };
      },
      start: async (i) => {
        const r = await createPayment({ orderId: i.orderId });
        if (!r.ok) throw new Error(`payment start failed: ${r.reason}`);
        return { redirectUrl: r.redirectUrl };
      },
    },
    inventory: () => registry.service('inventory'),
  });
  configureOrders({ inventory: () => registry.service('inventory') });
  configurePayments({ orders: paymentsOrdersPort });
}
