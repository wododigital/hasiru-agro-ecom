'use client';

import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useTransition } from 'react';
import { cn } from '../cn';
import { tableQuery, type TableParams } from '../domain/table-params';
import { fieldClass } from './Input';

export interface ToolbarFilter {
  key: string;
  label: string;
  options: readonly { value: string; label: string }[];
}

interface Props {
  basePath: string;
  params: TableParams;
  filters: readonly ToolbarFilter[];
  search: boolean;
  labels: { search: string; all: string };
}

/** Search + filter controls for DataTable. A plain GET form without JS; with JS it replaces the URL as you type (debounced). */
export function DataTableToolbarIsland({ basePath, params, filters, search, labels }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const go = (patch: Parameters<typeof tableQuery>[1]) => startTransition(() => router.replace(basePath + tableQuery(params, patch), { scroll: false }));

  return (
    <form role="search" method="get" action={basePath} aria-busy={pending} className={cn('flex flex-wrap items-center gap-2', pending && 'opacity-70')} onSubmit={(e) => e.preventDefault()}>
      {search ? (
        <div className="relative min-w-48 flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            name="q"
            aria-label={labels.search}
            placeholder={labels.search}
            defaultValue={params.q}
            onChange={(e) => {
              const q = e.target.value;
              clearTimeout(timer.current);
              timer.current = setTimeout(() => go({ q }), 300);
            }}
            className={cn(fieldClass, 'py-2 pl-9')}
          />
        </div>
      ) : null}
      {filters.map((f) => (
        <FilterSelect key={f.key} filter={f} value={params.filters[f.key] ?? ''} allLabel={labels.all} onPick={(v) => go({ filters: { [f.key]: v || null } })} />
      ))}
      {params.sort ? (
        <>
          <input type="hidden" name="sort" value={params.sort} />
          <input type="hidden" name="dir" value={params.dir} />
        </>
      ) : null}
    </form>
  );
}

function FilterSelect({ filter: f, value, allLabel, onPick }: { filter: ToolbarFilter; value: string; allLabel: string; onPick: (v: string) => void }) {
  const anyLabel = `${f.label}: ${allLabel}`;
  return (
        <select name={f.key} aria-label={f.label} defaultValue={value} onChange={(e) => onPick(e.target.value)} className={cn(fieldClass, 'w-auto py-2')}>
          <option value="">{anyLabel}</option>
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
  );
}
