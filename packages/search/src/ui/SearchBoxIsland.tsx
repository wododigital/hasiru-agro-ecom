'use client';

import { Button, Input, cn } from '@ecomkit/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { fmt, itemHref as hrefFor } from '../domain';
import type { Suggestion } from '../domain/suggest';
import { searchMessages, type SearchMessages } from '../messages';

export interface SearchBoxProps {
  defaultValue?: string;
  /** Results page; the form submits there without JS. */
  action?: string;
  suggestUrl?: string;
  /** Product link template with `{kind}` and `{slug}`, e.g. `/{kind}/{slug}`. */
  itemHref?: string;
  messages?: SearchMessages['search'];
  className?: string;
  autoFocus?: boolean;
}

/**
 * Typeahead (ARIA 1.2 combobox): suggestions after 2 characters, debounced, stale requests aborted,
 * arrow keys / Enter / Escape. Plain GET form underneath, so search works before hydration.
 */
export function SearchBox({ defaultValue = '', action = '/search', suggestUrl = '/api/search/suggest', itemHref = '/{kind}/{slug}', messages = searchMessages.search, className, autoFocus }: SearchBoxProps) {
  const [q, setQ] = useState(defaultValue);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const t = setTimeout(async () => {
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      try {
        const res = await fetch(`${suggestUrl}?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        if (!res.ok) return;
        const data = (await res.json()) as { items: Suggestion[] };
        setItems(data.items);
        setActive(-1);
      } catch {
        // aborted or offline: keep the last list
      }
    }, 120);
    return () => clearTimeout(t);
  }, [q, suggestUrl]);

  const go = (s: Suggestion) => window.location.assign(hrefFor(itemHref, s));
  const shown = q.trim().length >= 2 ? items : [];
  const expanded = open && shown.length > 0;

  return (
    <form role="search" action={action} method="get" className={cn('relative flex gap-2', className)} onSubmit={(e) => {
      if (expanded && active >= 0 && shown[active]) {
        e.preventDefault();
        go(shown[active]);
      }
    }}>
      <label htmlFor={`${listId}-input`} className="sr-only">
        {messages.label}
      </label>
      <Input
        id={`${listId}-input`}
        name="q"
        type="search"
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        enterKeyHint="search"
        maxLength={80}
        autoFocus={autoFocus}
        placeholder={messages.placeholder}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!expanded) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => (a + 1) % shown.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => (a <= 0 ? shown.length - 1 : a - 1));
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      <Button type="submit" data-cta="search-submit">
        {messages.submit}
      </Button>
      {expanded ? (
        <ul id={listId} role="listbox" aria-label={messages.suggestions} className="absolute inset-x-0 top-full z-30 mt-1 max-h-96 overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-card">
          {shown.map((s, i) => (
            <li
              key={s.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              data-cta="search-suggestion"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => go(s)}
              className={cn('flex min-h-11 cursor-pointer flex-col justify-center px-3 py-1.5', i === active ? 'bg-surface-2' : 'hover:bg-surface-2')}
            >
              <span className="font-medium text-text">
                {s.name}
                {s.nameLocal ? <span className="ml-2 text-sm text-muted">{s.nameLocal}</span> : null}
              </span>
              {s.matched === 'alias' ? <span className="text-xs text-muted">{fmt(messages.alsoKnownAs, { alias: s.matchedText })}</span> : s.scientificName ? <span className="text-xs text-muted italic">{s.scientificName}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
