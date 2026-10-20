import 'server-only';

export { cspSources, publicTagConfig, readPublicTagConfig, resetCspMemo, settingsDef } from './config';
export { deleteTag, getTag, listTags, saveTag } from './tags';
export { postConsent } from './consent';
export { getOrderAttribution, readAttribution, saveOrderAttribution, type CookieReader, type OrderAttribution } from './attribution';
export {
  configureMarketing,
  conversion,
  listConversions,
  onOrderPaid,
  onOrderRefunded,
  purchaseTagData,
  type ConversionResult,
} from './conversions';
export type { ConversionOrder, OrdersPort, PurchaseTagData } from '../domain/conversions';
export type { CustomTagConfig, PublicTagConfig } from '../domain/tags';
