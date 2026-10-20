import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageMetadata } from '@ecomkit/catalog/server';
import { SLUG_RE } from '@ecomkit/core/ids';
import { Breadcrumbs, buttonVariants } from '@ecomkit/ui';
import { activeModels, modelPage } from '../server/cached';
import { orElse, plantingRuntime } from '../server/runtime';
import { PlanDiagram } from '../ui/PlanDiagram';

type Params = { params: Promise<{ model: string }> };

/** Cache components need at least one param; `_none` fails SLUG_RE and 404s (same as catalog, cms, places). */
const PLACEHOLDER = '_none';

export async function generateStaticParams(): Promise<{ model: string }[]> {
  const slugs = (await orElse(() => activeModels(), [])).map((m) => ({ model: m.slug }));
  return slugs.length ? slugs : [{ model: PLACEHOLDER }];
}

async function load(params: Params['params']) {
  const { model } = await params;
  return SLUG_RE.test(model) ? orElse(() => modelPage(model), null) : null;
}

const text = (html: string | null) => (html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const data = await load(params);
  if (!data) return { robots: { index: false, follow: false } };
  return pageMetadata({ title: `${data.model.name} ${plantingRuntime().messages.results.modelSuffix}`, description: text(data.model.descriptionHtml).slice(0, 160), path: `/models/${data.model.slug}` });
}

/** /models/[model]: what the model is, its pattern, the plants it uses, videos and the way into the wizard. */
export default async function ModelPage({ params }: Params) {
  const data = await load(params);
  if (!data) notFound();
  const { model, layout, videos } = data;
  const rt = plantingRuntime();
  const m = rt.messages;
  const perBlock = layout.perBlock.M + layout.perBlock.X + layout.perBlock.O;
  const line = layout.blockFt.h === 0;
  return (
    <main className="mx-auto w-full max-w-5xl space-y-8 px-4 py-8">
      <Breadcrumbs items={[{ label: m.wizard.eyebrow, href: '/plan' }, { label: model.name }]} />
      <header className="space-y-3">
        <h1 className="font-display text-4xl text-primary">
          {model.name} {m.results.modelSuffix}
        </h1>
        {model.descriptionHtml ? (
          // eslint-disable-next-line react/no-danger -- sanitised with core safeHtml when saved
          <div className="prose max-w-3xl text-muted" dangerouslySetInnerHTML={{ __html: model.descriptionHtml }} />
        ) : null}
      </header>
      <section aria-labelledby="pattern-h" className="space-y-3">
        <h2 id="pattern-h" className="font-display text-2xl text-primary">
          {m.model.patternTitle}
        </h2>
        <p className="text-muted">
          <b className="tabular-nums">{perBlock}</b> {line ? m.model.perLine : m.model.perBlock}
        </p>
        <PlanDiagram layout={layout} legend={model.legend} messages={m} />
      </section>
      {videos.length ? (
        <section aria-labelledby="videos-h" className="space-y-2">
          <h2 id="videos-h" className="font-display text-2xl text-primary">
            {m.model.videos}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {videos.map((v) => (
              <li key={v.id}>
                <a href={v.url} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'subtle', size: 'sm' })} data-cta="model-watch-video">
                  {m.results.watch} {v.title}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Link href={`/plan?purpose=${model.slug}`} className={buttonVariants({ variant: 'accent' })} data-cta="model-plan-cta">
          {m.model.cta}
        </Link>
        <Link href={`/plants/for/${model.slug}`} className={buttonVariants({ variant: 'outline' })} data-cta="model-see-plants">
          {m.model.seeAll}
        </Link>
        {rt.registry?.has('planting-3d') ? (
          <Link href={`/models/${model.slug}/3d`} prefetch={false} className={buttonVariants({ variant: 'ghost' })} data-cta="model-view-3d">
            {m.results.view3d}
          </Link>
        ) : null}
      </div>
    </main>
  );
}
