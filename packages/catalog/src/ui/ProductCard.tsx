import { Badge, Chip, ImageWithFallback, Price, Rating, cn } from '@ecomkit/ui';
import Link from 'next/link';
import type { ProductCardData } from '../domain/card';
import { catalogMessages, type CatalogMessages } from '../messages';
import { CardBuyIsland } from './CardBuyIsland';

const chipTone = { neutral: '', success: 'text-success', warning: 'text-warning', accent: 'bg-accent/20' } as const;

export interface ProductCardProps {
  card: ProductCardData;
  /** Render the Add / stepper (only when the cart module is enabled). */
  cartEnabled: boolean;
  messages?: CatalogMessages;
  /** First cards above the fold load eagerly. */
  eager?: boolean;
}

/** The one product card: the same slots on every surface (listing, rails, search, recommendations). */
export function ProductCard({ card, cartEnabled, messages = catalogMessages, eager = false }: ProductCardProps) {
  const m = messages.card;
  return (
    <article className="relative flex h-full flex-col overflow-hidden rounded-md border border-border bg-surface shadow-card" data-product-id={card.id}>
      <Link href={card.href} className="relative block aspect-square bg-surface-2" aria-label={m.view(card.name)} data-cta="card-open-product">
        <ImageWithFallback image={card.image} alt={card.image?.alt ?? ''} fill sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw" className="object-cover" loading={eager ? 'eager' : 'lazy'} />
        {card.badges.length ? (
          <span className="absolute top-2 left-2 flex flex-col items-start gap-1">
            {card.badges.map((b) => (
              <Badge key={b.id} tone={b.tone}>
                {b.label}
              </Badge>
            ))}
          </span>
        ) : null}
      </Link>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        {card.collectionLine ? <p className="text-xs text-muted">{card.collectionLine}</p> : null}
        <h3 className="font-display text-base leading-tight text-text">
          <Link href={card.href} className="hover:underline">
            {card.name}
          </Link>
        </h3>
        {card.nameKn ? (
          <p lang="kn" className="text-xs text-muted">
            {card.nameKn}
          </p>
        ) : null}
        {card.chips.length ? (
          <ul className="flex flex-wrap gap-1">
            {card.chips.map((c) => (
              <li key={c.id}>
                <Chip className={cn(chipTone[c.tone])}>{c.label}</Chip>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-auto flex flex-col gap-1 pt-1">
          {card.price ? <Price paise={card.price.unitPaise} compareAtPaise={card.price.compareAtPaise} /> : null}
          {card.bulk ? <p className={cn('text-xs', card.bulk.reached ? 'font-semibold text-accent-fg bg-accent/30 rounded-sm px-1' : 'text-muted')}>{card.bulk.label}</p> : null}
          <div className="flex items-center justify-between gap-2">
            {card.rating ? <Rating average={card.rating.average} count={card.rating.count} /> : <span />}
            {card.stockLabel ? <span className={cn('text-xs', card.availability === 'low_stock' ? 'text-warning font-semibold' : card.notifyMe ? 'text-danger' : 'text-muted')}>{card.stockLabel}</span> : null}
          </div>
          {card.purchasable && cartEnabled && card.variantId ? (
            <CardBuyIsland variantId={card.variantId} itemName={card.name} cta="card-add-to-cart" />
          ) : card.notifyMe ? (
            <Link href={`${card.href}#notify`} className="text-sm font-semibold text-primary underline" data-cta="card-notify-me">
              {m.notifyMe}
            </Link>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function ProductGrid({ cards, cartEnabled, messages, eagerCount = 4 }: { cards: readonly ProductCardData[]; cartEnabled: boolean; messages?: CatalogMessages; eagerCount?: number }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {cards.map((card, i) => (
        <li key={card.id}>
          <ProductCard card={card} cartEnabled={cartEnabled} messages={messages} eager={i < eagerCount} />
        </li>
      ))}
    </ul>
  );
}
