import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Skeleton } from '@ecomkit/ui';
import { activeModels } from '../server/cached';
import { orElse, plantingRuntime } from '../server/runtime';
import { WizardIsland, type WizardModel } from '../ui/WizardIsland';

const summary = (html: string | null): string => (html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().split(/(?<=\.)\s/)[0] ?? '';

export function generateMetadata(): Metadata {
  const m = plantingRuntime().messages.wizard;
  return { title: m.title, description: m.intro, alternates: { canonical: '/plan' } };
}

/** /plan: static landing copy with the wizard island (model cards come from the database, cached). */
export default async function PlanPage() {
  const m = plantingRuntime().messages.wizard;
  const models: WizardModel[] = (await orElse(() => activeModels(), [])).map((x) => ({ slug: x.slug, name: x.name, summary: summary(x.descriptionHtml) }));
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
      <header className="space-y-2">
        <p className="text-sm font-semibold tracking-wide text-accent uppercase">{m.eyebrow}</p>
        <h1 className="font-display text-4xl text-primary">{m.title}</h1>
        <p className="text-muted">{m.intro}</p>
      </header>
      <Suspense fallback={<Skeleton className="h-[640px] w-full rounded-lg" />}>
        <WizardIsland models={models} messages={m} />
      </Suspense>
    </main>
  );
}
