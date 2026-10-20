import type { Metadata } from 'next';
import { farmCalculatorsRuntime } from '../server/runtime';
import { PlantCalculator } from '../ui/calculators';

export function generateMetadata(): Metadata {
  const m = farmCalculatorsRuntime().messages.plant;
  return { title: m.metaTitle, description: m.metaDescription, alternates: { canonical: '/calculators/plants' } };
}

/** /calculators/plants: the same island as the modal, inline. */
export default async function PlantCalculatorPage() {
  const m = farmCalculatorsRuntime().messages.plant;
  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8">
      <header className="space-y-2">
        <h1 className="font-display text-3xl text-primary md:text-4xl">{m.pageTitle}</h1>
        <p className="max-w-2xl text-muted">{m.pageLead}</p>
      </header>
      <PlantCalculator />
    </main>
  );
}
