'use client';

import { useRef, useState } from 'react';
import { Button, Dialog, DialogContent, DialogTrigger, Skeleton } from '@ecomkit/ui';
import type { PlantCalculatorData } from '../server/data';
import type { FarmCalculatorsMessages } from '../messages';
import { PlantCalculatorIsland } from './PlantCalculatorIsland';

export const PLANT_CALCULATOR_DATA_PATH = '/api/calculators/plants';

/**
 * Floating "Plant calculator" button (Home and shop pages, C2.8). The plant list loads on first open, so the
 * button costs the page nothing; Esc, the backdrop and the close button dismiss; a successful add closes it.
 */
export function PlantCalculatorLauncherIsland({ messages: m, cartEnabled }: { messages: FarmCalculatorsMessages['plant']; cartEnabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<PlantCalculatorData | null>(null);
  const [failed, setFailed] = useState(false);
  const inflight = useRef<Promise<void> | null>(null);

  /** One request at a time; hovering the button starts it early (intent prefetch). */
  const load = () =>
    (inflight.current ??= (async () => {
      setFailed(false);
      try {
        const res = await fetch(PLANT_CALCULATOR_DATA_PATH, { headers: { accept: 'application/json' } });
        if (!res.ok) throw new Error(String(res.status));
        setData((await res.json()) as PlantCalculatorData);
      } catch {
        setFailed(true);
      } finally {
        inflight.current = null;
      }
    })());
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && !data) void load();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="accent" className="fixed right-4 bottom-20 z-40 shadow-card md:bottom-6" data-cta="calculator-open-modal" onPointerEnter={() => !data && void load()}>
          {m.openButton}
        </Button>
      </DialogTrigger>
      <DialogContent side="sheet" title={m.modalTitle}>
        {data ? (
          <PlantCalculatorIsland plants={data.plants} books={data.books} messages={m} cartEnabled={cartEnabled} onAdded={() => setOpen(false)} />
        ) : failed ? (
          <div className="flex flex-col items-start gap-3" role="alert">
            <p>{m.loadFailed}</p>
            <Button variant="outline" onClick={() => void load()}>
              {m.retry}
            </Button>
          </div>
        ) : (
          <div className="grid gap-3" aria-busy="true" aria-label={m.loading}>
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-2/3" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
