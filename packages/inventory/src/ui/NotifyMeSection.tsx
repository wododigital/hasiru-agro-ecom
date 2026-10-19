import type { PdpSectionProps } from '@ecomkit/core/contracts';
import { getSettings } from '@ecomkit/core/settings';
import { inventoryMessages, type InventoryMessages } from '../messages';
import { inventorySettings, levelsForProduct } from '../server';
import { NotifyMeIsland } from './NotifyMeIsland';

/**
 * PDP section (slot `aside`): a back-in-stock form when no variant of the product has sellable stock.
 * Reads live stock, so the host renders it inside a Suspense boundary (a dynamic hole in the static PDP).
 */
export async function NotifyMeSection({ productId, messages = inventoryMessages }: PdpSectionProps & { messages?: InventoryMessages }) {
  const [levels, settings] = await Promise.all([levelsForProduct(productId), getSettings(inventorySettings)]);
  if (!settings.notifyMeEnabled || !levels.length || levels.some((l) => l.available > 0)) return null;
  const ready = levels.map((l) => l.readyInDays).filter((d): d is number => d != null);
  return (
    <div className="flex flex-col gap-2">
      {ready.length ? <p className="text-sm font-medium text-primary">{messages.preorder(Math.min(...ready))}</p> : null}
      <NotifyMeIsland variantIds={levels.map((l) => l.variantId)} messages={messages.notifyMe} />
    </div>
  );
}
