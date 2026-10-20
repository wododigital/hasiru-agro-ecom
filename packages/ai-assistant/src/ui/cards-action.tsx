'use server';

import { ProductCard } from '@ecomkit/catalog/ui';
import { catalogRuntime, getProductCardsByIds } from '@ecomkit/catalog/server';
import { Rail } from '@ecomkit/ui';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { assistantRuntime } from '../server/runtime';

const idsSchema = z.array(z.uuid()).max(8);

/**
 * The card rail under an answer: the catalog's own product card (price, bulk hint, stock, add to cart), rendered
 * on the server and streamed to the drawer. Unknown or hidden ids are dropped by the catalog read.
 */
export async function loadAssistantCards(ids: unknown): Promise<ReactNode> {
  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success || !parsed.data.length) return null;
  const cards = await getProductCardsByIds(parsed.data);
  if (!cards.length) return null;
  const rt = assistantRuntime();
  return (
    <Rail label={rt.messages.drawer.cardsHeading} itemWidth="168px">
      {cards.map((card) => (
        <ProductCard key={card.id} card={card} cartEnabled={!!rt.registry?.has('cart')} messages={catalogRuntime().messages} />
      ))}
    </Rail>
  );
}
