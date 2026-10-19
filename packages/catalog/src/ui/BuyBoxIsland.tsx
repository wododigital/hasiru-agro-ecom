'use client';

import type { Paise } from '@ecomkit/core/contracts';
import { formatINR } from '@ecomkit/core/money';
import { Button, Price, QtyStepper, Select } from '@ecomkit/ui';
import { useState, useTransition, type FormEvent } from 'react';
import { tierAt, type TierStep } from '../domain/tiers';
import type { CatalogMessages } from '../messages';
import { CART_LINES_PATH, changeCartLine } from './cart-client';

export interface BuyVariant {
  id: string;
  label: string;
}

export interface BuyBoxProps {
  name: string;
  variants: readonly BuyVariant[];
  list: TierStep;
  tiers: readonly TierStep[];
  /** Cart enabled and the product is purchasable. */
  canBuy: boolean;
  whatsappHref: string | null;
  labels: CatalogMessages['pdp'];
}

/**
 * Quantity, live bulk price and nudge, Add to cart / Buy now / Ask on WhatsApp. A plain form post underneath,
 * so buying works before hydration or without JS; with JS the add happens in place.
 */
export function BuyBoxIsland({ name, variants, list, tiers, canBuy, whatsappHref, labels: m }: BuyBoxProps) {
  const [variantId, setVariantId] = useState(variants[0]?.id ?? '');
  const [qty, setQty] = useState(1);
  const [pending, start] = useTransition();
  const at = tierAt(list, tiers, qty);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    const intent = ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value;
    if (intent !== 'add') return; // Buy now posts normally and lands on checkout
    e.preventDefault();
    start(async () => {
      await changeCartLine(variantId, qty);
    });
  };

  return (
    <form id="buy" method="post" action={CART_LINES_PATH} onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="variantId" value={variantId} />
      <input type="hidden" name="qty" value={qty} />
      <div className="flex items-baseline gap-2">
        <Price paise={at.unitPaise as Paise} size="lg" />
        <span className="text-sm text-muted">{m.perUnit}</span>
      </div>
      {at.next ? (
        <p className="rounded-sm bg-accent/20 px-2 py-1 text-sm" aria-live="polite">
          {m.nudge(at.next.more, formatINR(at.next.unitPaise as Paise), formatINR(at.next.savePaise as Paise))}
        </p>
      ) : null}
      {variants.length > 1 ? (
        <label className="flex flex-col gap-1 text-sm">
          {m.variant}
          <Select value={variantId} onChange={(e) => setVariantId(e.target.value)} data-cta="pdp-variant">
            {variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </Select>
        </label>
      ) : null}
      {canBuy ? (
        <>
          <QtyStepper value={qty} onChange={(n) => setQty(Math.max(1, n))} min={1} addButton={false} itemName={name} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" name="intent" value="add" disabled={pending} data-cta="pdp-add-to-cart">
              {m.addToCart}
            </Button>
            <Button type="submit" name="intent" value="buy" variant="accent" disabled={pending} data-cta="pdp-buy-now">
              {m.buyNow}
            </Button>
          </div>
        </>
      ) : null}
      {whatsappHref ? (
        <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-primary underline" data-cta="pdp-ask-whatsapp">
          {m.askWhatsApp}
        </a>
      ) : null}
    </form>
  );
}
