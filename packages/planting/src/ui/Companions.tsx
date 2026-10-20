import type { PdpSectionProps } from '@ecomkit/core/contracts';
import { productCards } from '@ecomkit/catalog/server';
import { ProductGrid } from '@ecomkit/catalog/ui';
import { companionIds } from '../server/plans';
import { orElse, plantingRuntime } from '../server/runtime';

/** PDP section "Grows well with": plants that share a planting model with this one in another role. */
export default async function Companions({ productId }: PdpSectionProps) {
  const rt = plantingRuntime();
  const m = rt.messages.companions;
  const ids = await orElse(() => companionIds(productId, 4), []);
  const cards = ids.length ? await orElse(() => productCards(ids), []) : [];
  if (!cards.length) return null;
  return (
    <section aria-labelledby="companions-heading" className="space-y-3">
      <h2 id="companions-heading" className="font-display text-2xl text-primary">
        {m.title}
      </h2>
      <p className="text-sm text-muted">{m.intro}</p>
      <ProductGrid cards={cards} cartEnabled={rt.registry?.has('cart') ?? false} eagerCount={0} />
    </section>
  );
}
