'use client';

import { Button, Checkbox, Chip, Input, Select, cn } from '@ecomkit/ui';
import { useEffect, useRef, useState } from 'react';
import { fmt } from '../domain';
import { clearKey, presetActive, removeChip, toggleValue, togglePreset, clearAll, type FacetState, type FacetView, type RangeSel, type RangeView } from '../domain/engine';
import { SORTS, type SortKey } from '../domain/facets';
import { useFacets } from './FacetProviderIsland';

export interface FacetGroupsProps {
  view: FacetView;
  state: FacetState;
  onChange(next: FacetState): void;
  onRange(key: string, range: RangeSel | null): void;
  /** Range inputs commit after this many ms of no typing (0 in the sheet draft). */
  debounceMs?: number;
  idPrefix: string;
}

const VISIBLE_VALUES = 6;

function RangeGroup({ range, selected, label, onCommit, debounceMs, idPrefix }: { range: RangeView; selected: RangeSel | null; label: string; onCommit(r: RangeSel | null): void; debounceMs: number; idPrefix: string }) {
  const { messages, rangeText } = useFacets();
  const [min, setMin] = useState(selected?.min?.toString() ?? '');
  const [max, setMax] = useState(selected?.max?.toString() ?? '');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Keep inputs in step with chips, presets and back/forward (adjust state during render, no effect).
  const selKey = `${selected?.min ?? ''}-${selected?.max ?? ''}`;
  const [prevKey, setPrevKey] = useState(selKey);
  if (selKey !== prevKey) {
    setPrevKey(selKey);
    setMin(selected?.min?.toString() ?? '');
    setMax(selected?.max?.toString() ?? '');
  }
  useEffect(() => () => clearTimeout(timer.current), []);
  const schedule = (a: string, b: string) => {
    clearTimeout(timer.current);
    const run = () => {
      const lo = a === '' ? null : Math.max(0, Number(a));
      const hi = b === '' ? null : Math.max(0, Number(b));
      if ((lo != null && !Number.isFinite(lo)) || (hi != null && !Number.isFinite(hi))) return;
      onCommit(lo == null && hi == null ? null : { min: lo, max: hi });
    };
    if (debounceMs) timer.current = setTimeout(run, debounceMs);
    else run();
  };
  const f = messages.filters;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="sr-only">{label}</legend>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted" htmlFor={`${idPrefix}-${range.key}-min`}>
          {f.min}
          <Input id={`${idPrefix}-${range.key}-min`} inputMode="numeric" type="number" min={0} placeholder={String(range.bounds.min)} value={min} onChange={(e) => (setMin(e.target.value), schedule(e.target.value, max))} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted" htmlFor={`${idPrefix}-${range.key}-max`}>
          {f.max}
          <Input id={`${idPrefix}-${range.key}-max`} inputMode="numeric" type="number" min={0} placeholder={String(range.bounds.max)} value={max} onChange={(e) => (setMax(e.target.value), schedule(min, e.target.value))} />
        </label>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {range.presets.map((p) => {
          const active = selected?.min === p.min && selected?.max === p.max;
          const text = rangeText(range.key, p.min, p.max);
          return (
            <button
              key={`${p.min}-${p.max}`}
              type="button"
              aria-pressed={active}
              data-cta={`filter-preset-${range.key}`}
              onClick={() => onCommit(active ? null : p)}
              className={cn('min-h-9 rounded-full border border-border px-3 text-sm', active ? 'bg-primary text-primary-fg' : 'bg-surface hover:bg-surface-2')}
            >
              {text}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Facet groups as fieldsets: checkboxes with live counts, zero-count options disabled (not hidden). */
export function FacetGroups({ view, state, onChange, onRange, debounceMs = 150, idPrefix }: FacetGroupsProps) {
  const { config, messages } = useFacets();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const f = messages.filters;
  const sections = [
    ...view.groups.map((g) => ({ key: g.key, label: g.label, group: g, range: null as RangeView | null })),
    ...view.ranges.map((r) => ({ key: r.key, label: messages.ranges[r.key] ?? r.key, group: null, range: r })),
  ];
  return (
    <div className="flex flex-col divide-y divide-border">
      {sections.map((s, i) => {
        // Checked state comes from the selection, not the computed view, so a tap shows at once even before the index arrives.
        const chosen = new Set(state.values[s.key] ?? []);
        const active = s.group ? chosen.size > 0 : !!state.ranges[s.key];
        return (
          <div key={s.key} className="relative py-3">
            {/* Reset sits beside the summary, not inside it (no nested interactive controls). */}
            {active ? (
              <button type="button" className="absolute top-3 right-0 z-10 min-h-11 text-sm text-primary-hover underline-offset-4 hover:underline" data-cta={`filter-reset-${s.key}`} onClick={() => onChange(clearKey(state, s.key))}>
                {f.reset}
              </button>
            ) : null}
            <details open={i < config.openGroups || active}>
              <summary className="flex min-h-11 cursor-pointer list-none items-center pr-16 font-semibold text-primary">{s.label}</summary>
              {s.range ? (
                <RangeGroup range={s.range} selected={state.ranges[s.key] ?? null} label={s.label} debounceMs={debounceMs} idPrefix={idPrefix} onCommit={(r) => onRange(s.key, r)} />
              ) : s.group ? (
                <fieldset className="flex flex-col">
                  <legend className="sr-only">{s.label}</legend>
                  {(expanded[s.key] ? s.group.values : s.group.values.slice(0, VISIBLE_VALUES)).map((v) => {
                    const id = `${idPrefix}-${s.key}-${v.value}`;
                    const disabled = v.count === 0 && !chosen.has(v.value);
                    return (
                      <label key={v.value} htmlFor={id} className={cn('flex min-h-11 items-center gap-3 text-sm', disabled ? 'text-muted' : 'cursor-pointer')}>
                        <Checkbox id={id} checked={chosen.has(v.value)} disabled={disabled} onChange={() => onChange(toggleValue(state, s.key, v.value))} className="size-5" />
                        <span className="flex-1">{s.group!.kind === 'toggle' ? s.label : v.label}</span>
                        <span className="text-muted tabular-nums">
                          {'('}
                          {v.count}
                          {')'}
                        </span>
                      </label>
                    );
                  })}
                  {s.group.values.length > VISIBLE_VALUES ? (
                    <button type="button" className="min-h-11 text-left text-sm text-primary-hover" onClick={() => setExpanded((e) => ({ ...e, [s.key]: !e[s.key] }))}>
                      {expanded[s.key] ? f.less : f.more}
                    </button>
                  ) : null}
                </fieldset>
              ) : null}
            </details>
          </div>
        );
      })}
    </div>
  );
}

/** Desktop sticky sidebar; instant apply. Hidden below md (the FilterSheet takes over). */
export function FacetSidebar({ className }: { className?: string }) {
  const ctx = useFacets();
  return (
    <aside aria-label={ctx.messages.filters.title} className={cn('sticky top-20 hidden max-h-[calc(100dvh-6rem)] overflow-y-auto pr-2 md:block', className)} onPointerEnter={ctx.prefetch} onFocus={ctx.prefetch}>
      <FacetGroups
        view={ctx.view}
        state={ctx.url.state}
        idPrefix="fs"
        onChange={ctx.apply}
        onRange={ctx.setRange}
      />
    </aside>
  );
}

/** Polite live region with the result count. */
export function ResultCount({ className }: { className?: string }) {
  const { view, messages, pending } = useFacets();
  const text = view.total === 1 ? messages.filters.countOne : fmt(messages.filters.count, { count: view.total });
  return (
    <p aria-live="polite" aria-busy={pending} className={cn('text-sm text-muted', className)}>
      {text}
    </p>
  );
}

export function SortSelect({ className, sorts }: { className?: string; sorts?: readonly SortKey[] }) {
  const { url, setSort, messages, defaultSort } = useFacets();
  const options = sorts ?? SORTS.filter((s) => s !== 'relevance' || defaultSort === 'relevance');
  return (
    <label className={cn('flex items-center gap-2 text-sm', className)}>
      <span className="text-muted">{messages.sort.label}</span>
      <Select value={url.sort} onChange={(e) => setSort(e.target.value as SortKey)} className="w-auto py-2" data-cta="listing-sort">
        {options.map((s) => (
          <option key={s} value={s}>
            {messages.sort[s]}
          </option>
        ))}
      </Select>
    </label>
  );
}

/** Applied filters as removable chips plus Clear all. Scrolls sideways on phones. */
export function AppliedChips({ className }: { className?: string }) {
  const ctx = useFacets();
  const { view, messages, url, config } = ctx;
  if (!view.chips.length) return null;
  return (
    <div className={cn('flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none]', className)} role="group" aria-label={messages.filters.applied}>
      {view.chips.map((chip) => {
        const label = chip.kind === 'range' ? ctx.rangeLabel(chip) : chip.label;
        return (
          <Chip key={chip.kind === 'range' ? chip.key : `${chip.key}:${chip.value}`} variant="filter" removeLabel={fmt(messages.filters.remove, { label })} onRemove={() => ctx.apply(removeChip(url.state, chip))}>
            {label}
          </Chip>
        );
      })}
      <Button variant="link" size="sm" data-cta="filter-clear-all" onClick={() => ctx.apply(clearAll(config))}>
        {messages.filters.clearAll}
      </Button>
    </div>
  );
}

/** One-tap preset combinations. A preset shows only when its facets exist in the current scope. */
export function QuickChips({ className }: { className?: string }) {
  const ctx = useFacets();
  const { config, view, url, messages } = ctx;
  const present = new Set([...view.groups.map((g) => g.key), ...view.ranges.map((r) => r.key)]);
  const presets = config.presets.filter((p) => [...Object.keys(p.values ?? {}), ...Object.keys(p.ranges ?? {})].every((k) => present.has(k)));
  if (!presets.length) return null;
  return (
    <div role="group" aria-label={messages.filters.quick} className={cn('flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]', className)} onPointerEnter={ctx.prefetch}>
      {presets.map((p) => {
        const on = presetActive(url.state, p);
        return (
          <button
            key={p.id}
            type="button"
            aria-pressed={on}
            data-cta={`quick-chip-${p.id}`}
            onClick={() => ctx.apply(togglePreset(url.state, p))}
            className={cn('min-h-11 shrink-0 rounded-full border px-4 text-sm font-medium whitespace-nowrap', on ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface text-primary hover:bg-surface-2')}
          >
            {messages.presets[p.id] ?? p.id}
          </button>
        );
      })}
    </div>
  );
}
