import type { ProductFormTabProps } from '@ecomkit/core/contracts';
import { EmptyState } from '@ecomkit/ui';
import { getAdminPricing } from '../server/pricing';
import { PricingFormIsland } from './PricingFormIsland';

/** The Pricing tab injected into the catalog product form (`productFormTabs`). */
export async function PricingTab({ productId }: ProductFormTabProps) {
  if (!productId) return <EmptyState title="Save the product first" body="Prices are set per variant once the product exists." />;
  const variants = await getAdminPricing(productId);
  if (!variants.length) return <EmptyState title="No variants yet" body="Add a variant to set its price." />;
  return (
    <div className="flex flex-col gap-4">
      {variants.map((v) => (
        <PricingFormIsland key={v.variantId} productId={productId} variant={v} />
      ))}
    </div>
  );
}

export default PricingTab;
