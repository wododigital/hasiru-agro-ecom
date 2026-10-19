'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Input } from '@ecomkit/ui';
import { placesMessages, type PlacesMessages } from '../messages';

export interface PlaceChoice {
  kind: 'district' | 'pincode' | 'alias';
  label: string;
  slug: string;
  name: string;
  stateCode: string;
  stateName: string;
  distanceKm: number | null;
}

export interface PlaceTypeaheadProps {
  onSelect: (choice: PlaceChoice) => void;
  /** Defaults to the module's route. */
  endpoint?: string;
  nearestEndpoint?: string;
  messages?: PlacesMessages['suggest'];
  /** Offer the "use my location" button. */
  geolocate?: boolean;
  name?: string;
  autoFocus?: boolean;
  defaultValue?: string;
}

/**
 * Combobox over /api/places/suggest (starts at 2 characters, 200 ms debounce, cancels stale requests).
 * Arrow keys move, Enter picks, Escape closes. Works with any caller: it only reports the chosen district.
 */
export function PlaceTypeaheadIsland({
  onSelect,
  endpoint = '/api/places/suggest',
  nearestEndpoint = '/api/places/nearest',
  messages = placesMessages.suggest,
  geolocate = false,
  name,
  autoFocus,
  defaultValue = '',
}: PlaceTypeaheadProps) {
  const listId = useId();
  const [value, setValue] = useState(defaultValue);
  const [items, setItems] = useState<PlaceChoice[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [searched, setSearched] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const picked = useRef(false);

  useEffect(() => {
    if (picked.current) {
      picked.current = false;
      return;
    }
    const q = value.trim();
    if (q.length < 2) return;
    const timer = setTimeout(async () => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      try {
        const res = await fetch(`${endpoint}?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { suggestions: PlaceChoice[] };
        setItems(body.suggestions);
        setSearched(true);
        setActive(-1);
        setOpen(true);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setItems([]);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [value, endpoint]);

  const shown = value.trim().length >= 2 ? items : [];

  function choose(choice: PlaceChoice) {
    picked.current = true;
    setValue(choice.label);
    setOpen(false);
    onSelect(choice);
  }

  function locate() {
    navigator.geolocation?.getCurrentPosition(async (pos) => {
      const res = await fetch(`${nearestEndpoint}?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`);
      if (!res.ok) return;
      const { district } = (await res.json()) as { district: { slug: string; name: string; stateCode: string; stateName: string; distanceKm: number | null } | null };
      if (district) choose({ kind: 'district', label: `${district.name}, ${district.stateName}`, slug: district.slug, name: district.name, stateCode: district.stateCode, stateName: district.stateName, distanceKm: district.distanceKm });
    });
  }

  return (
    <div className="relative">
      <Input
        name={name}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={messages.placeholder}
        aria-label={messages.placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => shown.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(shown.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter' && open && active >= 0 && shown[active]) {
            e.preventDefault();
            choose(shown[active]);
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open ? (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border border-border bg-surface shadow-card">
          {shown.length === 0 && searched ? <li className="px-3 py-2 text-sm text-muted">{messages.noResults}</li> : null}
          {shown.map((item, i) => (
            <li
              key={`${item.kind}-${item.slug}-${item.label}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`cursor-pointer px-3 py-2 ${i === active ? 'bg-surface-2' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(item);
              }}
            >
              {item.label}
            </li>
          ))}
        </ul>
      ) : null}
      {geolocate ? (
        <button type="button" onClick={locate} className="mt-2 text-sm font-medium text-primary underline" data-cta="places-use-my-location">
          {messages.useMyLocation}
        </button>
      ) : null}
    </div>
  );
}
