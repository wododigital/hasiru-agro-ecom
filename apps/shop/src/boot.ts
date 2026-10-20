// Boot wiring: binds every enabled module's ports once per process. Called from instrumentation `register()`
// (web), worker.ts and seed:load. Modules never import each other; this file is where they meet.
import {
  cartSummary,
  checkoutCart,
  configureCart,
  currentCartContext,
  inRequest,
  markConverted,
  replacePackage,
  restorePath,
  restoreToken,
} from '@ecomkit/cart/server';
import {
  configureCatalog,
  getProductBySlug,
  gstRatesFor,
  imagesFor,
  listProducts,
  mainMediaIds,
  productLabel,
  productSeo,
  variantBySku,
  variantFacts,
  variantsOf,
} from '@ecomkit/catalog/server';
import { checkoutContact, configureCheckout } from '@ecomkit/checkout/server';
import { configureCms, videosFor } from '@ecomkit/cms/server';
import { setAuthProvider } from '@ecomkit/core/auth-context';
import { loadEnv } from '@ecomkit/core/env';
import { getSettings } from '@ecomkit/core/settings';
import { contactPort, leadContact } from '@ecomkit/customers/server';
import { applicablePromos, applyCoupon, createSingleUseCode, evaluateCoupon, redeem, releaseRedemptions } from '@ecomkit/discounts/server';
import { configureEnquiries } from '@ecomkit/enquiries/server';
import { configureErpSync } from '@ecomkit/erp-sync/server';
import { configureFarmCalculators, recommendedInputs } from '@ecomkit/farm-calculators/server';
import { configureFlows, backInStockSender } from '@ecomkit/flows/server';
import { opsAdapter } from '@ecomkit/hasiru-ops-adapter/server';
import { setNotificationsProvider } from '@ecomkit/inventory/server';
import { configureMarketing, readAttribution } from '@ecomkit/marketing/server';
import { imageRefs, imageStore, masterAssetIds, privateStore } from '@ecomkit/media/server';
import { alert, configureMonitoring } from '@ecomkit/monitoring/server';
import {
  configureOrders,
  conversionOrder,
  flowsOrdersPort,
  guestTokenFor,
  orderForBuyer,
  ordersSettings,
  paymentsOrdersPort,
  verifiedOrderId,
  createOrder,
} from '@ecomkit/orders/server';
import { configurePayments, createPayment, loadSettings as paymentSettings, refund } from '@ecomkit/payments/server';
import { findPincode, loadStates, registerPlantSource } from '@ecomkit/places/server';
import { companionIds, configurePlanting, modelLayout } from '@ecomkit/planting/server';
import { configurePlanting3d } from '@ecomkit/planting-3d/server';
import { configurePricing } from '@ecomkit/pricing/server';
import { configureReviews } from '@ecomkit/reviews/server';
import { configureShipping } from '@ecomkit/shipping/server';
import { configureAssistant } from '@ecomkit/ai-assistant/server';
import { db } from '@ecomkit/core/db';
import { messages } from '../messages/en';
import type { Registry } from '@ecomkit/core/manifest';
import { registry as ownRegistry } from './generated/registry';
import { routeRegistry } from './route-registry';

// Reads through to the route bundle's registry copy when the root layout has published one (see route-registry.ts).
const registry: Registry = new Proxy(ownRegistry, { get: (own, key) => Reflect.get(routeRegistry() ?? own, key) });

const KEY = Symbol.for('hasiru.shop.booted');
type Holder = { [KEY]?: boolean };

/** Binds every port. Idempotent per process; `mediaDir` is only needed by seed:load (master image lookups). */
export async function boot(options: { mediaDir?: string } = {}): Promise<void> {
  const g = globalThis as Holder;
  if (g[KEY] && !options.mediaDir) return;
  g[KEY] = true;
  const env = loadEnv();
  const site = env.SITE_URL ?? 'http://localhost:3000';
  const m = messages;
  // auth and seo server code needs Next's server React build: bound only inside the Next server process.
  // The worker and seed:load run no page rendering, OTP or redirects, so they skip these two.
  const [auth, seo] = process.env.NEXT_RUNTIME === 'nodejs' ? await Promise.all([import('@ecomkit/auth/server'), import('@ecomkit/seo/server')]) : [null, null];

  // core + auth
  setAuthProvider(() => registry.service('auth'));
  auth?.configureAuth({
    notifications: () => registry.service('notifications'),
    appName: m.brand.name,
  });
  configureMonitoring({ registry });

  // catalog, pricing, inventory, places
  configureCatalog({
    registry,
    images: imageRefs,
    resolveMediaIds: options.mediaDir ? (srcs) => masterAssetIds(srcs, options.mediaDir!) : null,
    jsonLd: seo?.jsonLd() ?? null,
    metadata: seo?.buildMetadata ?? null,
    addRedirect: seo ? async (from, to) => void (await seo.addRedirect(from, to)) : null,
  });
  configurePricing({ gstRates: gstRatesFor, variantsOf });
  setNotificationsProvider(async () => backInStockSender);
  registerPlantSource(async () => {
    const { rows } = await listProducts({ kind: 'plant', limit: 1000 });
    const withClimate = rows.filter((r) => r.climate);
    const media = await mainMediaIds(withClimate.map((r) => r.id));
    const images = await imagesFor(Object.values(media));
    return withClimate.map((r) => ({
      sku: r.slug,
      name: r.name,
      nameKn: r.nameKn,
      path: `/plant/${r.slug}`,
      image: media[r.id] ? (images[media[r.id]!] ?? null) : null,
      climate: r.climate!,
    }));
  });

  // seo (web only)
  if (seo) {
    seo.configureSeo({
      site: {
        url: site,
        name: m.brand.name,
        description: m.home.hero.lead,
        phone: m.store.phone,
        email: m.store.email,
        businessType: 'GardenStore',
        address: m.store.address,
        returnPolicy: { category: 'not_permitted' },
        searchPath: '/search',
      },
      registry,
      robotsDisallow: ['/plan/results', '/api/cart/restore'],
      llms: { sections: m.store.llms },
      ogCard: async (path) => {
        const slug = /^\/(?:plant|input)\/([a-z0-9-]+)$/.exec(path)?.[1];
        const p = slug ? await getProductBySlug(slug) : null;
        return p
          ? {
              title: p.product.name,
              subtitle: p.product.shortDescription,
              eyebrow: m.brand.name,
            }
          : null;
      },
      images: imageRefs,
      entitySeo: productSeo,
      notFoundLinks: [
        { label: m.shell.notFound.search, href: '/search' },
        { label: m.shell.notFound.browse, href: '/plants' },
      ],
    });
  }
  // cms: every process (seed:load links block images, team photos and logos to media); the seo hooks only on the web.
  configureCms({
    images: imageRefs,
    resolveMediaIds: options.mediaDir ? (srcs) => masterAssetIds(srcs, options.mediaDir!) : null,
    ...(seo ? { metadata: seo.buildMetadata, jsonLd: seo.jsonLd, onMissing: seo.resolveMissing, addRedirect: seo.addRedirect } : {}),
  });

  // customers-side ports
  configureEnquiries({ contacts: contactPort, files: privateStore });
  configureReviews({
    purchases: { verifiedOrderId },
    images: imageStore,
    products: { label: productLabel },
  });

  // cart, shipping, checkout, orders, payments
  configureCart({
    variants: variantFacts,
    registry,
    discounts: {
      promos: (cart) => applicablePromos(cart),
      applyCoupon: (code, cart, ctx) => applyCoupon(code, cart, ctx),
      evaluateCoupon: (code, cart, ctx) => evaluateCoupon(code, cart, ctx),
    },
  });
  configureShipping({
    places: () => registry.service('places'),
    resolvePincode: async (pin) => {
      const hit = await findPincode(db, pin);
      return hit ? { districtSlug: hit.districtSlug, stateCode: hit.stateCode } : null;
    },
  });
  const discountCart = (
    lines: readonly {
      lineId: string;
      productId: string;
      qty: number;
      tierUnitPaise: number;
      collectionIds?: readonly string[];
      tagIds?: readonly string[];
    }[],
  ) => ({
    lines: lines.map((l) => ({
      lineId: l.lineId,
      productId: l.productId,
      qty: l.qty,
      unitPaise: l.tierUnitPaise,
      collectionIds: l.collectionIds ?? [],
      tagIds: l.tagIds ?? [],
    })),
    customer: null,
  });
  configureCheckout({
    cart: {
      current: async () => checkoutCart(await currentCartContext()),
      markConverted: async (cartId, orderId, o) => void (await markConverted(cartId, orderId, o)),
    },
    orders: {
      // checkout's input is the structural shape; orders validates it with its own schema.
      createOrder: (input, o) => createOrder(input as Parameters<typeof createOrder>[0], o),
      guestToken: guestTokenFor,
      sellerStateCode: async () => (await getSettings(ordersSettings)).sellerStateCode,
      forBuyer: async (id, token) => {
        const o = await orderForBuyer(id, token);
        return o
          ? {
              id: o.id,
              number: o.number,
              status: o.status,
              totalPaise: o.totalPaise,
              advancePaise: o.advancePaise,
              paidPaise: o.paidPaise,
              contact: o.contact as {
                name: string;
                phone: string | null;
                email: string | null;
              },
            }
          : null;
      },
    },
    payments: {
      config: async () => {
        const s = await paymentSettings();
        return {
          codMode: s.codMode,
          advancePct: s.advancePercent,
          attemptExpiryMinutes: s.attemptExpiryMinutes,
        };
      },
      start: async (i) => {
        const order = await paymentsOrdersPort.get(i.orderId, {});
        const method = order && i.amountPaise < order.totalPaise - order.paidPaise ? 'cod_partial' : 'online';
        const r = await createPayment({ orderId: i.orderId, method });
        if (!r.ok) throw new Error(`payment start failed: ${r.reason}`);
        return { redirectUrl: r.redirectUrl };
      },
    },
    inventory: () => registry.service('inventory'),
    shipping: () => registry.service('shipping'),
    discounts: {
      promos: (lines) => applicablePromos(discountCart(lines)),
      coupon: async (code, lines, ctx) => {
        const r = await applyCoupon(code, discountCart(lines), ctx);
        return r.ok
          ? {
              ok: true,
              ruleId: r.ruleId,
              codeId: r.codeId,
              discount: r.discount,
            }
          : { ok: false, reason: r.reason };
      },
      redeem,
    },
    regions: {
      states: async () => (await loadStates(db)).map((s) => ({ code: s.code, name: s.name })),
    },
    attribution: async () => {
      const { cookies, headers } = await import('next/headers');
      return {
        ...readAttribution(await cookies(), (await headers()).get('user-agent')),
      };
    },
  });
  configureOrders({
    inventory: () => registry.service('inventory'),
    discounts: { releaseRedemptions },
    payments: {
      refund: async (i) => {
        const r = await refund(i);
        return r.ok ? { ok: true, refundId: r.refund.id } : { ok: false, error: r.reason };
      },
      paymentLink: async ({ orderId }) => {
        const r = await createPayment({ orderId });
        return r.ok ? r.redirectUrl : null;
      },
    },
    catalog: {
      variantBySku: async (sku) => {
        const v = await variantBySku(sku);
        const price = v ? await (await registry.service('pricing'))?.getPrice(v.variantId, 1) : null;
        return v && price ? { ...v, unitPaise: price.unitPaise } : null;
      },
    },
  });
  configurePayments({ orders: paymentsOrdersPort, alert: (a) => alert(a) });

  // flows, marketing, erp
  configureFlows({
    carts: {
      snapshot: async (cartId, sessionId) => {
        const cart = await cartSummary(cartId);
        if (!cart) return null;
        const saved = sessionId ? await checkoutContact(sessionId) : await checkoutContact(cartId, { byCart: true });
        const contact =
          saved?.contact.phone || saved?.contact.email
            ? { customerId: cart.customerId, ...saved.contact }
            : cart.customerId
              ? { customerId: cart.customerId }
              : null;
        return {
          status: cart.status,
          contact,
          totalPaise: cart.totalPaise,
          itemCount: cart.itemCount,
        };
      },
      restoreLink: async (cartId, { couponCode, days }) => {
        const token = await restoreToken(cartId, { days, couponCode });
        return token ? `${site}${restorePath(token)}` : null;
      },
    },
    orders: flowsOrdersPort,
    leads: {
      get: async (id) => {
        const l = await leadContact(id);
        return l ? { ...l, link: l.link ? `${site}${l.link}` : null } : null;
      },
    },
    products: {
      label: async (id) => {
        const l = await productLabel(id);
        return l ? { ...l, href: `${site}${l.href}` } : null;
      },
    },
    discounts: { createSingleUseCode },
  });
  configureMarketing({ orders: { forConversion: conversionOrder } });
  configureErpSync({ adapter: opsAdapter });

  // planting, calculators, 3D, assistant
  configurePlanting({
    registry,
    cart: {
      replacePackage: async ({ packageKey, lines }) => {
        await inRequest((ctx) =>
          replacePackage(ctx, {
            packageId: packageKey,
            lines: lines.map((l) => ({
              variantId: l.variantId,
              qty: l.qty,
              origin: l.origin,
            })),
          }),
        );
        return { ok: true };
      },
    },
    inputs: {
      recommend: async ({ lines, sqft }) =>
        (
          await recommendedInputs({
            plants: lines.map((l) => ({ qty: l.qty, role: l.role })),
            acres: sqft / 43_560,
          })
        ).flatMap((r) =>
          r.variantId
            ? [
                {
                  productId: r.inputProductId,
                  variantId: r.variantId,
                  name: r.name,
                  packLabel: `${r.packSize} ${r.unit}`,
                  qty: r.packs,
                  unitPaise: null,
                },
              ]
            : [],
        ),
    },
    otp: auth ? { send: auth.sendOtp, verify: auth.verifyOtp } : null,
    videos: async (slug) =>
      (await videosFor({ modelSlug: slug })).map((v) => ({
        id: v.id,
        title: v.title,
        url: v.url,
      })),
  });
  configureFarmCalculators({
    registry,
    cartLines: async () => {
      const cart = await checkoutCart(await currentCartContext());
      return cart?.lines.map((l) => ({ productId: l.productId, qty: l.qty })) ?? [];
    },
  });
  configurePlanting3d({
    layout: async ({ modelSlug, planId }) => {
      const layout = await modelLayout(modelSlug, { planId });
      return layout ? { layout } : null;
    },
  });
  configureAssistant({
    registry,
    companions: async (ids) => Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await companionIds(id)] as const))),
  });
}
