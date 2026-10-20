'use client';

import { useEffect, useRef, useState } from 'react';
import { uiMessages } from '../messages';

/**
 * Sticky contextual save bar (Shopify "Unsaved changes"). Place it inside an edit form: it appears once any field
 * changes; Discard resets the form, Save submits it. Hidden while the form is pristine.
 */
export function SaveBarIsland({ saveLabel = uiMessages.saveBar.save, pending = false }: { saveLabel?: string; pending?: boolean }) {
  const l = uiMessages.saveBar;
  const ref = useRef<HTMLDivElement>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    const form = ref.current?.closest('form');
    if (!form) return;
    const mark = () => setDirty(true);
    const clear = () => setDirty(false);
    form.addEventListener('input', mark);
    form.addEventListener('reset', clear);
    form.addEventListener('submit', clear);
    return () => {
      form.removeEventListener('input', mark);
      form.removeEventListener('reset', clear);
      form.removeEventListener('submit', clear);
    };
  }, []);
  return (
    <div ref={ref} role="region" aria-label={l.unsaved} hidden={!dirty} className="sticky top-0 z-40 -mx-4 flex items-center justify-between gap-3 bg-text px-4 py-2 text-bg lg:-mx-8 lg:px-8">
      <p className="text-sm font-semibold">{l.unsaved}</p>
      <div className="flex gap-2">
        <button type="reset" className="rounded-sm border border-bg/30 px-3 py-1.5 text-sm">
          {l.discard}
        </button>
        <button type="submit" disabled={pending} className="rounded-sm bg-bg px-3 py-1.5 text-sm font-semibold text-text disabled:opacity-60">
          {saveLabel}
        </button>
      </div>
    </div>
  );
}
