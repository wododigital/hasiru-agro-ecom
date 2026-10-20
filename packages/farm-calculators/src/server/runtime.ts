import type { ModuleId } from '@ecomkit/core/contracts';
import { mergeMessages, type FarmCalculatorsMessages, type FarmCalculatorsMessagesOverride } from '../messages';

/** A cart line as the compost calculator's "Plants in my cart" mode needs it. */
export interface CartPlantLine {
  productId: string;
  qty: number;
}

/**
 * What the host app binds at boot (same pattern as configureCatalog). Every field is optional: without a
 * registry the "Add to cart" buttons are hidden, without `cartLines` the compost calculator offers manual mode only.
 */
export interface FarmCalculatorsRuntimeInput {
  registry?: { has(id: ModuleId): boolean } | null;
  /** The visitor's cart lines (request-time). */
  cartLines?: (() => Promise<readonly CartPlantLine[]>) | null;
  messages?: FarmCalculatorsMessagesOverride;
}

export interface FarmCalculatorsRuntime {
  cartEnabled: boolean;
  cartLines: (() => Promise<readonly CartPlantLine[]>) | null;
  messages: FarmCalculatorsMessages;
}

const KEY = Symbol.for('ecomkit.farm-calculators.runtime');
type Holder = { [KEY]?: FarmCalculatorsRuntime };

export function configureFarmCalculators(input: FarmCalculatorsRuntimeInput): void {
  (globalThis as Holder)[KEY] = {
    cartEnabled: input.registry?.has('cart') ?? false,
    cartLines: input.cartLines ?? null,
    messages: mergeMessages(input.messages),
  };
}

export function farmCalculatorsRuntime(): FarmCalculatorsRuntime {
  return (globalThis as Holder)[KEY] ?? { cartEnabled: false, cartLines: null, messages: mergeMessages() };
}
