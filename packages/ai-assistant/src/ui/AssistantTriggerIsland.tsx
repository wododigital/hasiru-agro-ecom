'use client';

import { Button } from '@ecomkit/ui';
import { lazy, Suspense, useState } from 'react';
import type { PanelProps } from './AssistantPanelIsland';

// The drawer is its own chunk: fetched on intent (hover, focus, touch) and mounted on first open.
const loadPanel = () => import('./AssistantPanelIsland');
const Panel = lazy(() => loadPanel().then((m) => ({ default: m.AssistantPanel })));

export type TriggerProps = Omit<PanelProps, 'open' | 'onOpenChange'> & { className?: string };

/** Header button that opens the assistant drawer. */
export function AssistantTriggerIsland({ className, ...panel }: TriggerProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const prefetch = () => void loadPanel();
  return (
    <>
      <Button
        variant="accent"
        size="sm"
        className={className}
        aria-label={panel.copy.drawer.triggerAria}
        aria-haspopup="dialog"
        onPointerEnter={prefetch}
        onFocus={prefetch}
        onTouchStart={prefetch}
        onClick={() => {
          setMounted(true);
          setOpen(true);
        }}
        data-cta="assistant-open"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="currentColor">
          <path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9zM19 14l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9z" />
        </svg>
        <span className="max-[380px]:sr-only">{panel.copy.drawer.trigger}</span>
      </Button>
      {mounted ? (
        <Suspense fallback={null}>
          <Panel {...panel} open={open} onOpenChange={setOpen} />
        </Suspense>
      ) : null}
    </>
  );
}
