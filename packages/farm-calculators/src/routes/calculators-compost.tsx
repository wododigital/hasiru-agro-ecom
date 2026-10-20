import type { Metadata } from 'next';
import { farmCalculatorsRuntime } from '../server/runtime';
import { CompostCalculator } from '../ui/calculators';

export function generateMetadata(): Metadata {
  const m = farmCalculatorsRuntime().messages.compost;
  return { title: m.metaTitle, description: m.metaDescription, alternates: { canonical: '/calculators/compost' } };
}

/** /calculators/compost: static shell; the visitor's cart streams in for the "Plants in my cart" mode. */
export default async function CompostCalculatorPage() {
  const m = farmCalculatorsRuntime().messages.compost;
  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8">
      <header className="space-y-2">
        <h1 className="font-display text-3xl text-primary md:text-4xl">{m.pageTitle}</h1>
        <p className="max-w-2xl text-muted">{m.pageLead}</p>
      </header>
      <CompostCalculator />
    </main>
  );
}
