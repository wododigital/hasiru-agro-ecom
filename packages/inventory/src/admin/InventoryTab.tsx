import type { ProductFormTabProps } from '@ecomkit/core/contracts';
import { EmptyState } from '@ecomkit/ui';
import { levelsForProduct } from '../server';
import { LevelCard } from './LevelCard';

/** Inventory tab injected into the catalog product form (productFormTabs). */
export async function InventoryTab({ productId }: ProductFormTabProps) {
  if (!productId) return <EmptyState title="Save the product first" body="Stock is tracked per variant once the product exists." />;
  const levels = await levelsForProduct(productId);
  if (!levels.length) {
    return <EmptyState title="No stock record yet" body="Levels are created by the seed import, the ERP pull or a count on the inventory page." />;
  }
  return (
    <div className="flex flex-col gap-4">
      {levels.map((level) => (
        <LevelCard key={level.variantId} level={level} showLink />
      ))}
    </div>
  );
}
