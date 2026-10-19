'use client';

import { Button, Select, Sheet, SheetContent, SheetTrigger, StickyBar, cn } from '@ecomkit/ui';
import { useState } from 'react';
import { fmt } from '../domain';
import { clearAll, setRange, type FacetState } from '../domain/engine';
import { SORTS, type SortKey } from '../domain/facets';
import { FacetGroups } from './FacetControlsIsland';
import { useFacets } from './FacetProviderIsland';

/**
 * Mobile: sticky "Filter · Sort" bar with an applied-count badge, opening a bottom sheet. Choices go
 * into a draft with a live "Show N results" count; nothing changes behind the sheet until Apply.
 */
export function FilterSheet({ className }: { className?: string }) {
  const ctx = useFacets();
  const { messages, url, view } = ctx;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FacetState>(url.state);
  const [sort, setSort] = useState<SortKey>(url.sort);
  const f = messages.filters;

  const preview = open ? ctx.preview(draft) : null;
  const shown = preview ?? view;
  const count = preview ? preview.total : null;
  const applyText = count == null ? f.apply : count === 0 ? f.showNone : count === 1 ? f.showOne : fmt(f.show, { count });
  const sorts = SORTS.filter((s) => s !== 'relevance' || ctx.defaultSort === 'relevance');

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setDraft(url.state);
          setSort(url.sort);
          ctx.prefetch();
        }
        setOpen(next);
      }}
    >
      <StickyBar className={cn('justify-center p-2', className)}>
        <SheetTrigger asChild>
          <Button variant="primary" size="md" className="w-full" data-cta="filter-sheet-open" onPointerDown={ctx.prefetch}>
            {f.open}
            {' · '}
            {messages.filters.sortShort}
            {view.chips.length ? <span className="ml-1 grid min-w-6 place-items-center rounded-full bg-primary-fg px-1.5 text-sm text-primary">{view.chips.length}</span> : null}
          </Button>
        </SheetTrigger>
      </StickyBar>
      <SheetContent side="bottom" title={f.title} className="h-[92dvh] gap-0 pb-0">
        <div className="flex-1">
          <label className="flex items-center justify-between gap-3 border-b border-border py-3 text-sm font-semibold text-primary">
            {messages.sort.label}
            <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="w-auto py-2">
              {sorts.map((s) => (
                <option key={s} value={s}>
                  {messages.sort[s]}
                </option>
              ))}
            </Select>
          </label>
          <FacetGroups view={shown} state={draft} idPrefix="sh" debounceMs={0} onChange={setDraft} onRange={(key, r) => setDraft((d) => setRange(d, key, r))} />
        </div>
        <div className="sticky bottom-0 -mx-5 flex items-center gap-3 border-t border-border bg-surface px-5 py-3 pb-[max(.75rem,env(safe-area-inset-bottom))]">
          <Button variant="ghost" data-cta="filter-sheet-clear" onClick={() => setDraft(clearAll(ctx.config))}>
            {f.clearAll}
          </Button>
          <Button
            className="flex-1"
            data-cta="filter-sheet-apply"
            aria-live="polite"
            onClick={() => {
              ctx.apply(draft, sort);
              setOpen(false);
            }}
          >
            {applyText}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
