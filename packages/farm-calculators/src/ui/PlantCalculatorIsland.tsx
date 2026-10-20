'use client';

import { useId, useState, useTransition } from 'react';
import { formatINR } from '@ecomkit/core/money';
import { quote, type PriceBook } from '@ecomkit/pricing/domain';
import { Button, Checkbox, FormField, Input, Price, Segmented, Select, toast } from '@ecomkit/ui';
import { convertArea, DEFAULT_SPACING_FT, plantCalcInputSchema, plantCount, type AreaUnit, type CalcPlant, type Layout } from '../domain';
import { fill, type FarmCalculatorsMessages } from '../messages';
import { addToCart } from './cart';

export interface PlantCalculatorIslandProps {
  plants: readonly CalcPlant[];
  /** Price books keyed by variant id (empty: no prices shown). */
  books: Readonly<Record<string, PriceBook>>;
  messages: FarmCalculatorsMessages['plant'];
  cartEnabled: boolean;
  /** Called after a successful add (the modal closes itself). */
  onAdded?: () => void;
}

/** Plant calculator (C2.9): plant fills spacing, acre / sq ft converts on toggle, square or triangular, 3% buffer, A10 rounding. */
export function PlantCalculatorIsland({ plants, books, messages: m, cartEnabled, onAdded }: PlantCalculatorIslandProps) {
  const id = useId();
  const [plantId, setPlantId] = useState('');
  const [area, setArea] = useState('1');
  const [unit, setUnit] = useState<AreaUnit>('acre');
  const [lengthFt, setLength] = useState(String(DEFAULT_SPACING_FT));
  const [widthFt, setWidth] = useState(String(DEFAULT_SPACING_FT));
  const [layout, setLayout] = useState<Layout>('square');
  const [buffer, setBuffer] = useState(true);
  const [pending, start] = useTransition();

  const input = plantCalcInputSchema.parse({ area, unit, lengthFt, widthFt, layout, buffer });
  const count = plantCount(input);
  const plant = plants.find((p) => p.id === plantId) ?? null;
  const book = plant?.variantId ? books[plant.variantId] : undefined;
  const q = book && count.total > 0 ? quote(book, count.total) : null;

  const pick = (next: string) => {
    setPlantId(next);
    const p = plants.find((x) => x.id === next);
    if (p) {
      setLength(String(p.spacing[0]));
      setWidth(String(p.spacing[1]));
    }
  };
  const toggleUnit = (next: string) => {
    const to = next as AreaUnit;
    if (to === unit) return;
    setArea(String(convertArea(input.area, unit, to)));
    setUnit(to);
  };
  const add = () => {
    if (!plant?.variantId || count.total < 1) return;
    const variantId = plant.variantId;
    start(async () => {
      if (await addToCart([{ variantId, qty: count.total }])) {
        toast(fill(m.added, { count: count.total, name: plant.name }));
        onAdded?.();
      } else toast.error(m.addFailed);
    });
  };

  return (
    <div className="grid gap-5 md:grid-cols-[1.2fr_1fr]">
      <div className="flex flex-col gap-4">
        <FormField id={`${id}-plant`} label={m.plantLabel}>
          {(c) => (
            <Select {...c} value={plantId} onChange={(e) => pick(e.target.value)}>
              <option value="">{m.customSpacing}</option>
              {plants.map((p) => (
                <option key={p.id} value={p.id}>
                  {fill(m.plantOption, { name: p.name, l: p.spacing[0], w: p.spacing[1] })}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-area`} className="text-sm font-semibold text-primary">
            {m.areaLabel}
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Input id={`${id}-area`} type="number" inputMode="decimal" min={0} step={unit === 'acre' ? 0.25 : 100} value={area} onChange={(e) => setArea(e.target.value)} className="max-w-40" />
            <Segmented
              name={`${id}-unit`}
              label={m.unitLabel}
              value={unit}
              onChange={toggleUnit}
              options={[
                { value: 'acre', label: m.acre },
                { value: 'sqft', label: m.sqft },
              ]}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField id={`${id}-l`} label={m.lengthLabel}>
            {(c) => <Input {...c} type="number" inputMode="decimal" min={1} value={lengthFt} onChange={(e) => setLength(e.target.value)} />}
          </FormField>
          <FormField id={`${id}-w`} label={m.widthLabel}>
            {(c) => <Input {...c} type="number" inputMode="decimal" min={1} value={widthFt} onChange={(e) => setWidth(e.target.value)} />}
          </FormField>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-primary">{m.layoutLabel}</span>
          <Segmented
            name={`${id}-layout`}
            label={m.layoutLabel}
            value={layout}
            onChange={(v) => setLayout(v as Layout)}
            options={[
              { value: 'square', label: m.square },
              { value: 'triangular', label: m.triangular },
            ]}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={buffer} onChange={(e) => setBuffer(e.target.checked)} />
          {m.buffer}
        </label>
      </div>

      <div className="flex flex-col gap-3 rounded-lg bg-primary p-5 text-primary-fg" aria-live="polite">
        <p className="text-sm opacity-80">{m.resultLead}</p>
        <p className="font-display text-5xl leading-none tabular-nums" data-testid="plant-count">
          {count.total.toLocaleString('en-IN')}
        </p>
        <p className="text-sm opacity-85">{plant ? plant.name : m.plantsWord}</p>
        <dl className="flex flex-col gap-1.5 border-t border-primary-fg/20 pt-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt>{m.perAcre}</dt>
            <dd className="font-semibold tabular-nums">{count.perAcre.toLocaleString('en-IN')}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>{m.spacing}</dt>
            <dd className="font-semibold">{fill(m.spacingValue, { l: input.lengthFt, w: input.widthFt, layout: layout === 'triangular' ? m.triangular : m.square })}</dd>
          </div>
          {q ? (
            <div className="flex justify-between gap-3">
              <dt>{m.price}</dt>
              <dd className="text-right">
                <Price paise={q.lineTotalPaise} className="[&_b]:text-primary-fg" />
                <span className="block text-xs opacity-85">{fill(m.each, { price: formatINR(q.unitPaise) })}</span>
              </dd>
            </div>
          ) : null}
        </dl>
        {q?.tier ? <p className="text-xs font-semibold text-accent">{m.bulkApplies}</p> : q?.nextTier ? <p className="text-xs opacity-85">{fill(m.bulkFrom, { qty: q.nextTier.minQty, more: q.nextTier.qtyToGo })}</p> : null}
        {cartEnabled ? (
          <Button variant="accent" onClick={add} disabled={!plant?.variantId || count.total < 1 || pending} data-cta="calculator-add-plants">
            {plant ? fill(m.add, { count: count.total }) : m.pickToAdd}
          </Button>
        ) : null}
        <p className="text-xs opacity-75">{m.formula}</p>
      </div>
    </div>
  );
}
