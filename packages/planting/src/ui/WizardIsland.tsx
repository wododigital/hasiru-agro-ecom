'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { placesMessages } from '@ecomkit/places/messages';
import { PlaceTypeaheadIsland, type PlaceChoice } from '@ecomkit/places/ui';
import { Button, cn, Input, Segmented } from '@ecomkit/ui';
import { MIN_SQFT, SQFT_PER_ACRE } from '../domain/types';
import type { PlantingMessages } from '../messages';

export interface WizardModel {
  slug: string;
  name: string;
  summary: string;
}

type Chosen = Pick<PlaceChoice, 'slug' | 'name' | 'stateName' | 'distanceKm'>;
const LOCAL_KM = 60;

const fmt = (n: number, digits = 2) => n.toLocaleString('en-IN', { maximumFractionDigits: digits });

/**
 * Help me choose: location (district typeahead, "use my location"), land (acre / sq ft with live conversion, optional
 * boundary length) and purpose (data-driven model cards). Posts to /api/plan/generate and opens the results.
 * Prefills from `?district=&sqft=&purpose=` (district pages, saved land "Regenerate").
 */
export function WizardIsland({ models, messages, endpoint = '/api/plan/generate' }: { models: readonly WizardModel[]; messages: PlantingMessages['wizard']; endpoint?: string }) {
  const m = messages;
  const router = useRouter();
  const params = useSearchParams();
  const ids = useId();
  const preDistrict = params.get('district');
  const preSqft = Number(params.get('sqft'));
  const [place, setPlace] = useState<Chosen | null>(
    preDistrict && /^[a-z0-9-]{2,80}$/.test(preDistrict) ? { slug: preDistrict, name: preDistrict.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), stateName: '', distanceKm: null } : null,
  );
  const [unit, setUnit] = useState<'acre' | 'sqft'>('acre');
  const [amount, setAmount] = useState(preSqft > 0 ? fmt(preSqft / SQFT_PER_ACRE).replace(/,/g, '') : '1');
  const [boundary, setBoundary] = useState('');
  const prePurpose = params.get('purpose');
  const [purpose, setPurpose] = useState(models.some((x) => x.slug === prePurpose) ? prePurpose! : (models[0]?.slug ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get('error') ? m.error : null);

  const value = Number(amount);
  const sqft = unit === 'acre' ? value * SQFT_PER_ACRE : value;
  const landOk = Number.isFinite(sqft) && sqft >= MIN_SQFT;
  const done = [place !== null, landOk, purpose !== ''];

  const switchUnit = (next: string) => {
    if (next === unit) return;
    if (Number.isFinite(value) && value > 0) setAmount(next === 'sqft' ? String(Math.round(value * SQFT_PER_ACRE)) : String(Number((value / SQFT_PER_ACRE).toFixed(3))));
    setUnit(next as 'acre' | 'sqft');
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!place) return setError(m.needDistrict);
    if (!landOk) return setError(m.minLand);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ district: place.slug, sqft: Math.round(sqft), boundaryFt: boundary || undefined, purpose }),
      });
      const body = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !body.url) throw new Error(body.error ?? 'failed');
      router.push(body.url);
    } catch (err) {
      setError((err as Error).message === 'district' ? m.needDistrict : m.error);
      setBusy(false);
    }
  }

  const step = (n: number, title: string) => (
    <h2 className="flex items-center gap-3 font-display text-xl text-primary">
      <span aria-hidden="true" className={cn('grid size-8 place-items-center rounded-full text-sm font-semibold', done[n - 1] ? 'bg-primary text-primary-fg' : 'bg-surface-2 text-primary')}>
        {n}
      </span>
      {title}
    </h2>
  );

  return (
    <form onSubmit={submit} className="space-y-8 rounded-lg border border-border bg-surface p-5 shadow-card sm:p-8" noValidate>
      <ol className="flex gap-2" aria-label={m.progress}>
        {done.map((d, i) => (
          <li key={i} className={cn('h-1.5 flex-1 rounded-full', d ? 'bg-primary' : 'bg-surface-2')}>
            <span className="sr-only">
              {m.progress} {i + 1} {m.progressOf} {done.length}
            </span>
          </li>
        ))}
      </ol>

      <section className="space-y-3">
        {step(1, m.step1)}
        <PlaceTypeaheadIsland geolocate onSelect={(c) => setPlace(c)} defaultValue={place?.name ?? ''} messages={{ ...placesMessages.suggest, placeholder: m.step1Placeholder } as unknown as typeof placesMessages.suggest} />
        {place ? (
          <p className="text-sm text-success" role="status">
            {m.chosenPrefix} {place.name}
            {place.stateName ? `, ${place.stateName}` : ''}
            {place.distanceKm === null ? null : place.distanceKm <= LOCAL_KM ? `, ${m.localDelivery}` : `, ${Math.round(place.distanceKm)} ${m.kmFromNursery}`}
          </p>
        ) : null}
      </section>

      <section className="space-y-3">
        {step(2, m.step2)}
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor={`${ids}-land`} className="sr-only">
            {m.landLabel}
          </label>
          <Input id={`${ids}-land`} type="number" inputMode="decimal" min={0} step={unit === 'acre' ? 0.25 : 100} value={amount} onChange={(e) => setAmount(e.target.value)} className="w-36" aria-invalid={!landOk} />
          <Segmented name={`${ids}-unit`} label={m.unitLabel} value={unit} onChange={switchUnit} options={[{ value: 'acre', label: m.acre }, { value: 'sqft', label: m.sqft }]} />
          <span className="text-sm text-muted tabular-nums" aria-live="polite">
            {landOk ? (unit === 'acre' ? `${m.equals} ${fmt(sqft, 0)} ${m.sqftUnit}` : `${m.equals} ${fmt(sqft / SQFT_PER_ACRE, 3)} ${m.acres}`) : m.minLand}
          </span>
        </div>
        <div className="space-y-1">
          <label htmlFor={`${ids}-boundary`} className="text-sm font-semibold">
            {m.boundaryLabel}
          </label>
          <Input id={`${ids}-boundary`} type="number" inputMode="numeric" min={0} step={10} value={boundary} onChange={(e) => setBoundary(e.target.value)} className="w-36" aria-describedby={`${ids}-bhelp`} />
          <p id={`${ids}-bhelp`} className="text-xs text-muted">
            {m.boundaryHelp}
          </p>
        </div>
      </section>

      <section className="space-y-3">
        {step(3, m.step3)}
        <div role="radiogroup" aria-label={m.step3} className="grid gap-3 sm:grid-cols-2">
          {models.map((x) => (
            <label key={x.slug} className="cursor-pointer rounded-md border-2 border-border bg-surface p-4 transition-colors has-checked:border-primary has-checked:bg-surface-2 has-focus-visible:outline-2 has-focus-visible:outline-ring">
              <input type="radio" name="purpose" value={x.slug} checked={purpose === x.slug} onChange={() => setPurpose(x.slug)} className="sr-only" />
              <span className="block font-semibold text-primary">{x.name}</span>
              <span className="mt-1 block text-sm text-muted">{x.summary}</span>
            </label>
          ))}
        </div>
      </section>

      <div className="space-y-2">
        {error ? (
          <p role="alert" className="text-sm font-semibold text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="accent" size="lg" className="w-full" disabled={busy} data-cta="wizard-generate">
          {busy ? m.generating : m.generate}
        </Button>
        <p className="text-center text-sm text-muted">{m.freeNote}</p>
      </div>
    </form>
  );
}
