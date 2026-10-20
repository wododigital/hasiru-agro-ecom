'use client';

import { useId, useState, useTransition } from 'react';
import { quote, type PriceBook } from '@ecomkit/pricing/domain';
import { Button, Input, Price, Segmented, toast } from '@ecomkit/ui';
import { linesFromSizes, recommendInputs, SIZE_CLASSES, type DosageRule, type PlantLine, type SizeClass } from '../domain';
import { fill, type FarmCalculatorsMessages } from '../messages';
import type { CalcInput } from '../server/data';
import { addToCart } from './cart';

export interface CompostCalculatorIslandProps {
  rules: readonly DosageRule[];
  inputs: readonly CalcInput[];
  books: Readonly<Record<string, PriceBook>>;
  /** Plants in the visitor's cart (role from size class, own compost kg); null or empty: manual mode only. */
  cartPlants: readonly (PlantLine & { size: SizeClass })[] | null;
  messages: FarmCalculatorsMessages['compost'];
  cartEnabled: boolean;
}

const DEFAULT_COUNTS: Record<SizeClass, number> = { L: 0, M: 100, S: 0 };

/** Compost calculator (C1.7): plants in the cart or entered by size class; packs rounded up; "Add recommended pack" adds (A11). */
export function CompostCalculatorIsland({ rules, inputs, books, cartPlants, messages: m, cartEnabled }: CompostCalculatorIslandProps) {
  const id = useId();
  const hasCart = !!cartPlants?.some((l) => l.qty > 0);
  const [mode, setMode] = useState<'cart' | 'manual'>(hasCart ? 'cart' : 'manual');
  const [counts, setCounts] = useState(DEFAULT_COUNTS);
  const [pending, start] = useTransition();

  const cartBySize = Object.fromEntries(SIZE_CLASSES.map((s) => [s, (cartPlants ?? []).filter((l) => l.size === s).reduce((a, l) => a + l.qty, 0)])) as Record<SizeClass, number>;
  const plants = mode === 'cart' && hasCart ? cartPlants! : linesFromSizes(counts);
  const shown = mode === 'cart' && hasCart ? cartBySize : counts;
  const totalPlants = plants.reduce((a, l) => a + l.qty, 0);
  const byId = new Map(inputs.map((i) => [i.id, i]));
  const needs = recommendInputs({ plants, acres: 0, rules }).flatMap((n) => {
    const info = byId.get(n.inputProductId);
    if (!info) return [];
    const book = info.variantId ? books[info.variantId] : undefined;
    return [{ ...n, info, price: book ? quote(book, n.packs) : null }];
  });
  const addable = needs.filter((n) => n.info.variantId);

  const add = () =>
    start(async () => {
      const ok = await addToCart(addable.map((n) => ({ variantId: n.info.variantId!, qty: n.packs })));
      if (ok) toast(m.added);
      else toast.error(m.addFailed);
    });

  return (
    <div className="grid gap-5 md:grid-cols-[1.2fr_1fr]">
      <div className="flex flex-col gap-4">
        {hasCart ? (
          <Segmented
            name={`${id}-mode`}
            label={m.modeLabel}
            value={mode}
            onChange={(v) => setMode(v as 'cart' | 'manual')}
            options={[
              { value: 'cart', label: m.modeCart },
              { value: 'manual', label: m.modeManual },
            ]}
          />
        ) : null}
        {!hasCart && cartPlants ? <p className="text-sm text-muted">{m.cartEmpty}</p> : null}
        <div className="flex flex-col divide-y divide-border">
          {SIZE_CLASSES.map((s) => (
            <div key={s} className="flex items-center justify-between gap-3 py-2.5">
              <label htmlFor={`${id}-${s}`} className="font-medium">
                {m.sizes[s]}
              </label>
              {mode === 'cart' && hasCart ? (
                <b id={`${id}-${s}`} className="tabular-nums">
                  {shown[s].toLocaleString('en-IN')}
                </b>
              ) : (
                <Input
                  id={`${id}-${s}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={counts[s]}
                  onChange={(e) => setCounts((c) => ({ ...c, [s]: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))}
                  className="max-w-28"
                  aria-label={fill(m.sizeCount, { label: m.sizes[s] })}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-lg bg-primary p-5 text-primary-fg" aria-live="polite">
        <p className="text-sm opacity-80">{fill(m.resultLead, { plants: totalPlants })}</p>
        {needs.length ? (
          <ul className="flex flex-col gap-2 text-sm" data-testid="compost-needs">
            {needs.map((n) => (
              <li key={n.inputProductId} className="flex items-start justify-between gap-3 border-b border-primary-fg/20 pb-2">
                <span>
                  <b className="block">{n.info.name}</b>
                  <span className="text-xs opacity-85">
                    {fill(m.amount, { amount: Math.round(n.amount * 10) / 10, unit: n.unit })}
                    {' · '}
                    {fill(m.packs, { packs: n.packs, pack: `${n.packSize.toLocaleString('en-IN')} ${n.unit}` })}
                  </span>
                </span>
                {n.price ? <Price paise={n.price.lineTotalPaise} size="sm" className="[&_b]:text-primary-fg" /> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm">{m.nothing}</p>
        )}
        {cartEnabled ? (
          <Button variant="accent" onClick={add} disabled={!addable.length || pending} data-cta="calculator-add-compost-pack">
            {m.addPack}
          </Button>
        ) : null}
        <p className="text-xs opacity-75">{m.note}</p>
      </div>
    </div>
  );
}
