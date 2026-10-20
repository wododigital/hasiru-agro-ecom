'use client';

import type { ReactNode } from 'react';

/** Submits the surrounding form when a control inside changes (the form still has its own button without JS). */
export function SubmitOnChangeIsland({ children }: { children: ReactNode }) {
  return <div onChange={(e) => (e.target as HTMLInputElement).form?.requestSubmit()}>{children}</div>;
}
