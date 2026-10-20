# @ecomkit/cart

Cookie-keyed database cart: product and package lines with per-unit weight, merge on sign-in, totals preview through `core.computeTotals` (no second pipeline), cart blocks, abandoned-cart events and restore links. Brand-neutral; store copy comes from the host through `configureCart({ messages })`.

## Responsibility

- One live cart per visitor. Guests are keyed by an httpOnly `cart` cookie (32 random bytes; only its sha256 is stored). A signed-in customer's cart is keyed by `customer_id`; on the first read after sign-in a guest cart is merged into it (product lines add up, a newer package replaces the old one, the guest cart closes as `merged`), or claimed when the customer has none. A stale cookie never shows a customer's cart to a guest.
- Lines are `product` (shop, calculator, assistant) or `package` (a planting plan); unique per `(cart, variant, kind)`, so the same plant can sit in both zones and its quantities sum for the bulk tier (pricing's `priceLines` cross-line summation).
- Per-unit `weightKg` = `origin.weightKg` (planting override, e.g. 0.8 kg) else the catalog variant weight; carried on the cart-block lines for the truck meter.
- Totals: lines priced by `@ecomkit/pricing`, automatic promos and the coupon from the discounts port, packing and transport from the chosen shipping method, all fed to `core.computeTotals`. Unpriced or unpurchasable lines stay visible as unavailable and leave the totals.

## Public API

`@ecomkit/cart/server` (context-taking functions; `ctx = { token, customerId, now?, createSubject? }`):

| Function | What |
|---|---|
| `addLine(ctx, { variantId, qty, origin? })` | add to the product line; creates the cart (returns `issuedToken` for the cookie) |
| `changeQty(ctx, { variantId, delta })` | the catalog buttons' contract; 0 or below removes |
| `setQty(ctx, { lineId, qty })`, `removeLine(ctx, lineId)` | own lines only (null for anyone else's line) |
| `replacePackage(ctx, { packageId, landSqft?, lines })` | swaps the package lines; unpurchasable variants are skipped and returned; `[]` removes the package |
| `applyCoupon(ctx, code)`, `storeCoupon(ctx, null)` | typed code (rate-limited by discounts per cart) stored only when it applies; re-checked on every view |
| `setDeliveryMethod(ctx, methodId)` | remembered choice; only an available method is ever selected |
| `getCartView(ctx)`, `cartTotals(ctx)`, `cartCount(ctx)`, `findCart(ctx)` | reads (merge on sign-in happens here) |
| `getCart()`, `currentCartContext()`, `inRequest(fn)` | request-bound (next/headers); `inRequest` writes the cookie when a cart was created, e.g. `inRequest((ctx) => replacePackage(ctx, input))` |
| `markConverted(cartId, orderId, { tx })`, `noteContact(cartId, { tx })` | checkout hooks (place-order; contact saved) |
| `restoreToken(cartId, { days?, couponCode? })`, `restorePath(token)`, `peekRestore(ctx, token)`, `restoreCart(ctx, token)` | signed, single-use reminder links (HMAC over cart id, expiry, a nonce bound to the cart's cookie token, optional code; `restoreLinkDays` default) |
| `markAbandoned({ now })` | the idle sweep (scheduled job) |
| `configureCart({ variants, registry, discounts, readDistrict, messages })` | host binding at boot |

`@ecomkit/cart/ui`: `CartPageView` (page body), `CartSkeleton`, `CartButton` (header button + drawer; render inside Suspense), `CartDrawerIsland`.

## Host binding (required)

```ts
configureCart({
  variants: (ids) => /* catalog: { variantId, productId, kind, name, nameKn, label, href, weightKg, image, purchasable, collectionIds, tagIds } by id */,
  registry, // has / service / list('cartBlocks')
  discounts: { promos: applicablePromos, applyCoupon: (code, cart, { subject, customerId }) => applyCoupon(code, cart, { subject, customerId }), evaluateCoupon },
});
```

Without `variants` a cart with lines throws "cart is not configured". Without `discounts` there are no promos and no coupon field.

## Tables

`cart_cart` (token hash, customer, status `active|abandoned|converted|merged`, coupon, delivery choice, activity, contact, plan id, land size), `cart_line` (variant, qty > 0, kind, origin jsonb). No foreign keys into other modules.

## Routes

| Path | What |
|---|---|
| `/cart` | server-rendered page in its own Suspense boundary, noindex |
| `GET /api/cart` | drawer summary (formatted strings), no-store |
| `POST /api/cart/lines` | JSON `{ variantId, delta }` -> `{ qty }`; form `variantId, qty, intent=add|buy` -> 303 `/cart` or `/checkout`. Same-origin only, 4 KB body, 30 new carts per IP per hour |
| `GET /api/cart/restore?t=` | restore link page (noindex, not frameable, item count only, changes nothing: preview bots fetch it); `POST` (same origin) opens the cart on this device with a new cookie and lands on `/cart`; a used link fails; a customer's cart asks for sign-in and is never handed to another visitor |

## Settings (`/admin/settings/cart`)

`abandonAfterMinutes` (60), `restoreLinkDays` (30), `cookieDays` (60), `inputsHref` (`/inputs`).

## Events and jobs

- Emits `cart.updated { cartId }` (at most once a minute per cart, and on create, merge, re-open) and `cart.abandoned { cartId, checkoutSessionId: null, hasContact }` (once per idle stretch).
- Job `cart.mark-abandoned` every 5 minutes (singleton).

## Extension points

Renders `cartBlocks` with placement `cart` or `both` (props: `cartId`, `lines` with `weightKg`, `totals`, `selectedMethodId`). Delivery chooser from the `shipping` service, stock notes from `inventory`, both optional.

## How to disable

Remove `cart` from `modules.config.ts`. Catalog hides its buy buttons (`registry.has('cart')`); checkout depends on cart.
