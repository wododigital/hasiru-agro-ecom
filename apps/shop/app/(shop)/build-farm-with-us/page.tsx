import { EnquiryForm } from '@ecomkit/enquiries/ui';
import { Skeleton } from '@ecomkit/ui';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { buildFarmCopy as copy } from './copy';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const metadata: Metadata = {
  title: copy.metaTitle,
  description: copy.metaDescription,
  alternates: { canonical: '/build-farm-with-us' },
};

// The form carries a per-request time token, so it renders in its own dynamic hole under a skeleton.
async function FormSlot({ searchParams }: { searchParams: SearchParams }) {
  return <EnquiryForm kind="farm_development" returnTo="/build-farm-with-us" searchParams={await searchParams} />;
}

function FormSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} className="h-16" />
      ))}
    </div>
  );
}

/** /build-farm-with-us: the farm development enquiry (works without JS; posts to /api/enquiry). */
export default function BuildFarmWithUsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10 px-4 py-10">
      <header className="flex max-w-3xl flex-col gap-3">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary-hover">{copy.eyebrow}</p>
        <h1 className="font-display text-4xl text-primary sm:text-5xl">{copy.title}</h1>
        <p className="text-lg text-muted">{copy.lead}</p>
      </header>
      <div className="grid gap-10 lg:grid-cols-[1fr_2fr]">
        <section aria-labelledby="steps-title" className="flex flex-col gap-4">
          <h2 id="steps-title" className="font-display text-2xl text-primary">
            {copy.stepsTitle}
          </h2>
          <ol className="flex flex-col gap-4">
            {copy.steps.map((s, i) => (
              <li key={s.title} className="flex gap-3">
                <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-primary font-semibold text-primary-fg">
                  {i + 1}
                </span>
                <div>
                  <p className="font-semibold">{s.title}</p>
                  <p className="text-sm text-muted">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
        <section aria-labelledby="form-title" className="flex flex-col gap-4 rounded-lg bg-surface p-5 shadow-card">
          <h2 id="form-title" className="font-display text-2xl text-primary">
            {copy.formTitle}
          </h2>
          <Suspense fallback={<FormSkeleton />}>
            <FormSlot searchParams={searchParams} />
          </Suspense>
        </section>
      </div>
    </div>
  );
}
