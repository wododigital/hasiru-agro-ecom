import type { TrackEvent, TrackEventName } from '@ecomkit/core/contracts';

type Queue = { push(item: [TrackEventName, TrackEvent['props']]): unknown };

/**
 * Records an event from client code (`track('add_to_cart', { item_id, qty, value })`). Calls made before the
 * collector loads wait in `window.__ekq`; it drains them on start. A no-op on the server.
 * Prop conventions read by the reports: search { q, results }, filter_apply { facet, value, results },
 * add_to_cart { item_id, qty, value }, purchase { value (paise), test }, wizard_step { step }, calculator_used { calculator }.
 */
export function track(name: TrackEventName, props?: TrackEvent['props']): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { __ekq?: Queue };
  (w.__ekq ??= [] as unknown as Queue).push([name, props ?? {}]);
}
