// Server components that load data and mount the calculator islands (inline on a page or the home page).
import { Suspense } from 'react';
import { EmptyState, Skeleton } from '@ecomkit/ui';
import { plantLinesFor } from '../server/catalog-source';
import { compostCalculatorData, plantCalculatorData, type CompostCalculatorData } from '../server/data';
import { farmCalculatorsRuntime } from '../server/runtime';
import { CompostCalculatorIsland } from './CompostCalculatorIsland';
import { PlantCalculatorIsland } from './PlantCalculatorIsland';
import { PlantCalculatorLauncherIsland } from './PlantCalculatorLauncherIsland';

/** Inline plant calculator (home, /calculators/plants). */
export async function PlantCalculator() {
  const rt = farmCalculatorsRuntime();
  const data = await plantCalculatorData();
  return <PlantCalculatorIsland plants={data.plants} books={data.books} messages={rt.messages.plant} cartEnabled={rt.cartEnabled} />;
}

/** Floating button + modal; mount once in a layout or page. Loads plants only when opened. */
export function PlantCalculatorLauncher() {
  const rt = farmCalculatorsRuntime();
  return <PlantCalculatorLauncherIsland messages={rt.messages.plant} cartEnabled={rt.cartEnabled} />;
}

async function CompostWithCart({ data }: { data: CompostCalculatorData }) {
  const rt = farmCalculatorsRuntime();
  let cartPlants = null;
  try {
    // Request-time: the visitor's cart. Without a binding (or on failure) the calculator offers manual mode.
    cartPlants = rt.cartLines ? await plantLinesFor(await rt.cartLines()) : null;
  } catch {
    cartPlants = null;
  }
  return <CompostCalculatorIsland {...data} cartPlants={cartPlants} messages={rt.messages.compost} cartEnabled={rt.cartEnabled} />;
}

export function CompostSkeleton() {
  return (
    <div className="grid gap-5 md:grid-cols-[1.2fr_1fr]" aria-hidden="true">
      <Skeleton className="h-56 w-full" />
      <Skeleton className="h-56 w-full" />
    </div>
  );
}

/** Inline compost calculator (home, /calculators/compost). The static part renders first; the cart mode streams in. */
export async function CompostCalculator() {
  const rt = farmCalculatorsRuntime();
  const data = await compostCalculatorData();
  if (!data.rules.length) return <EmptyState title={rt.messages.compost.unavailable} />;
  return (
    <Suspense fallback={<CompostCalculatorIsland {...data} cartPlants={null} messages={rt.messages.compost} cartEnabled={rt.cartEnabled} />}>
      <CompostWithCart data={data} />
    </Suspense>
  );
}
