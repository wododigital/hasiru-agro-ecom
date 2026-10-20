import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listingIndexing, pageMetadata } from '@ecomkit/catalog/server';
import { ListingPage } from '@ecomkit/catalog/ui';
import { SLUG_RE } from '@ecomkit/core/ids';
import { buttonVariants } from '@ecomkit/ui';
import { activeModel, activeModels } from '../server/cached';
import { orElse, plantingRuntime } from '../server/runtime';

type SP = Promise<Record<string, string | string[] | undefined>>;
type Props = { params: Promise<{ model: string }>; searchParams: SP };

const PLACEHOLDER = '_none';

export async function generateStaticParams(): Promise<{ model: string }[]> {
  const slugs = (await orElse(() => activeModels(), [])).map((m) => ({ model: m.slug }));
  return slugs.length ? slugs : [{ model: PLACEHOLDER }];
}

async function load(params: Props['params']) {
  const { model } = await params;
  const found = SLUG_RE.test(model) ? await orElse(() => activeModel(model), null) : null;
  return found && found.members.length ? found : null;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const model = await load(params);
  if (!model) return { robots: { index: false, follow: false } };
  const m = plantingRuntime().messages.forModel;
  const { page, noindex } = listingIndexing(await searchParams);
  return pageMetadata({ title: `${m.titlePrefix} ${model.name}`, description: m.intro, path: `/plants/for/${model.slug}`, page, noindex });
}

/** /plants/for/[model]: the curated listing of a model's plants, rendered by the catalog listing template. */
export default async function PlantsForModelPage({ params, searchParams }: Props) {
  const model = await load(params);
  if (!model) notFound();
  const m = plantingRuntime().messages.forModel;
  const title = `${m.titlePrefix} ${model.name}`;
  return (
    <>
      <ListingPage
        title={title}
        intro={m.intro}
        path={`/plants/for/${model.slug}`}
        breadcrumbs={[{ label: model.name, href: `/models/${model.slug}` }, { label: title }]}
        filter={{ kind: 'plant', ids: model.members.map((x) => x.productId) }}
        searchParams={searchParams}
      />
      <p className="mx-auto w-full max-w-7xl px-4 pb-8">
        <Link href={`/plan?purpose=${model.slug}`} className={buttonVariants({ variant: 'accent' })} data-cta="for-model-plan-cta">
          {m.planCta}
        </Link>
      </p>
    </>
  );
}
