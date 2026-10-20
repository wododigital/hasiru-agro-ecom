import 'server-only';

// Public server API of the cart (BUILD-PLAN 2.5). Context-taking functions are the core API (tests, checkout,
// planting); `getCart`, `inRequest` and the route handlers bind them to the current request.
export {
  addLine,
  cartLines,
  CartError,
  cartSettings,
  changeQty,
  findCart,
  hashToken,
  markAbandoned,
  markConverted,
  noteContact,
  peekRestore,
  readCartSettings,
  removeLine,
  replacePackage,
  restoreCart,
  restorePath,
  restoreToken,
  setDeliveryMethod,
  setQty,
  storeCoupon,
  type CartAbandonedPayload,
  type CartContext,
  type CartErrorCode,
  type Mutation,
  type RestoreFailure,
  type RestorePeek,
  type RestoreResult,
  type RestoreTokenOptions,
} from './cart';
export { applyCoupon, cartCount, cartTotals, getCartView, loadCartView, toDrawerData, type CartView, type CartViewLine, type DrawerData } from './view';
export { cartContextFromRequest, cartCookieHeader, currentCartContext, getCart, inRequest, writeCartCookie } from './request';
export {
  cartRuntime,
  configureCart,
  type CartDiscountsPort,
  type CartRegistry,
  type CartRuntimeInput,
  type CartVariant,
  type CouponOutcome,
  type DiscountCartInput,
} from './runtime';
