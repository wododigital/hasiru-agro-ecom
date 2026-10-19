/** Beacon event names (frozen). Ingest rejects anything else. */
export const TRACK_EVENTS = [
  'page_view',
  'view_item',
  'view_item_list',
  'select_item',
  'add_to_cart',
  'remove_from_cart',
  'view_cart',
  'begin_checkout',
  'add_shipping_info',
  'add_payment_info',
  'purchase',
  'search',
  'filter_apply',
  'wizard_step',
  'plan_generated',
  'plan_unlocked',
  'calculator_used',
  'assistant_open',
  'assistant_question',
  'enquiry_submit',
  'notify_me',
  'cta_click',
  'scroll_depth',
  'attention',
  'web_vital',
  'js_error',
  'rage_click',
  'dead_click',
] as const;
export type TrackEventName = (typeof TRACK_EVENTS)[number];

export interface TrackEvent {
  name: TrackEventName;
  props?: Readonly<Record<string, string | number | boolean | null>>;
  /** Client epoch ms; the server stamps its own time too. */
  ts?: number;
}
