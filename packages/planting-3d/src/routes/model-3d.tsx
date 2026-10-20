import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { z } from 'zod';
import { buildViewerData, patchSpecFor } from '../domain';
import { fill } from '../messages';
import { planting3dRuntime } from '../server/runtime';
import { PlantingViewerIsland } from '../ui/PlantingViewerIsland';
import { ViewerSkeleton } from '../ui/ViewerSkeleton';

type Props = { params: Promise<{ model: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const input = z.object({
  model: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,59}$/),
  plan: z.uuid().nullable().catch(null),
});

export function generateMetadata(): Metadata {
  const m = planting3dRuntime().messages;
  // A viewer, not a landing page: kept out of search results (BUILD-PLAN 4.1).
  return { title: m.metaTitle, description: m.metaDescription, robots: { index: false, follow: true } };
}

async function Viewer({ params, searchParams }: Props) {
  const rt = planting3dRuntime();
  const sp = await searchParams;
  const parsed = input.safeParse({ model: (await params).model, plan: typeof sp.plan === 'string' ? sp.plan : null });
  if (!parsed.success || !rt.layout) notFound();
  const { model, plan } = parsed.data;
  const source = await rt.layout({ modelSlug: model, planId: plan });
  if (!source) notFound();
  const data = buildViewerData(source, patchSpecFor(source.layout.modelSlug, rt.patches));
  const m = rt.messages;
  return (
    <>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-2xl text-primary md:text-3xl">{fill(m.title, { model: data.modelName })}</h1>
        <Link href={plan ? `/plan/results/${plan}` : `/models/${model}`} className="text-sm font-semibold text-primary-hover underline-offset-4 hover:underline" data-cta="viewer-back">
          {plan ? m.backToPlan : m.back}
        </Link>
      </header>
      <PlantingViewerIsland data={data} messages={m} />
    </>
  );
}

/** /models/[model]/3d?plan=<planId>: the model's sample layout, or the visitor's plan when `plan` is given. */
export default function Model3dPage(props: Props) {
  return (
    <main className="mx-auto w-full max-w-7xl space-y-3 px-4 py-4">
      <Suspense fallback={<ViewerSkeleton />}>
        <Viewer {...props} />
      </Suspense>
    </main>
  );
}
