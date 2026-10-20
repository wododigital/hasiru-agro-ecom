import 'server-only';

export {
  addCodes,
  applicablePromos,
  applyCoupon,
  COUPON_ATTEMPT_LIMIT,
  COUPON_ATTEMPT_WINDOW_SEC,
  createSingleUseCode,
  evaluateCoupon,
  getRule,
  hashPhone,
  listRules,
  redeem,
  RedemptionError,
  releaseRedemptions,
  saveRule,
  type CouponResult,
  type RedeemInput,
  type RedemptionFailure,
  type RuleDetail,
  type RuleListRow,
} from './discounts';
