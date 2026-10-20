import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { getViewer } from '@ecomkit/core/auth-context';
import { Chip, Skeleton } from '@ecomkit/ui';
import { SQFT_PER_ACRE } from '../domain/types';
import { planView } from '../server/plans';
import { plantingRuntime } from '../server/runtime';
import { PlanDiagram } from '../ui/PlanDiagram';
import { ResultsIsland, type ClientPlan } from '../ui/ResultsIsland';
import { UnlockIsland } from '../ui/UnlockIsland';

type Props = { params: Promise<{ planId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export function generateMetadata(): Metadata {
  return { title: plantingRuntime().messages.results.title, robots: { index: false, follow: false } };
}

const UNLOCK_ERRORS = new Set(['invalid', 'code_invalid', 'limited', 'not_found', 'wrong_mode', 'not_configured']);
const fmt = (n: number, digits: number) => n.toLocaleString('en-IN', { maximumFractionDigits: digits });

async function Results({ params, searchParams }: Props) {
  const { planId } = await params;
  const view = await planView(planId);
  if (!view) notFound();
  const [viewer, sp] = await Promise.all([getViewer(), searchParams]);
  const rt = plantingRuntime();
  const m = rt.messages;
  const acres = view.sqft / SQFT_PER_ACRE;
  const purposeModel = view.models.find((x) => x.slug === view.purpose) ?? view.models[0];
  const unlockError = typeof sp.unlock === 'string' && UNLOCK_ERRORS.has(sp.unlock) ? (sp.unlock === 'code_invalid' ? m.unlock.codeInvalid : sp.unlock === 'limited' ? m.unlock.limited : m.unlock.invalid) : null;
  const plan: ClientPlan = {
    ...view,
    models: view.models.map(({ layout, ...rest }) => ({ ...rest, perBlockTotal: layout.perBlock.M + layout.perBlock.X + layout.perBlock.O })),
  };
  const diagrams = Object.fromEntries(view.models.map((x) => [x.slug, <PlanDiagram key={x.slug} layout={x.layout} legend={x.legend} messages={m} />]));
  const site = (process.env.SITE_URL ?? '').replace(/\/$/, '');

  return (
    <>
      <ul className="flex flex-wrap gap-2" aria-label={m.results.title}>
        <li>
          <Chip>
            {view.district.name}
            {view.district.stateName ? `, ${view.district.stateName}` : ''}
          </Chip>
        </li>
        <li>
          <Chip>{acres >= 0.1 ? `${fmt(acres, 2)} ${fmt(acres, 2) === '1' ? m.wizard.acreOne : m.wizard.acres}` : `${fmt(view.sqft, 0)} ${m.wizard.sqftUnit}`}</Chip>
        </li>
        {purposeModel ? (
          <li>
            <Chip>{purposeModel.isLine ? `${Math.round(view.boundaryFt)} ${m.results.lineSuffix}` : `${purposeModel.blocks.toFixed(1)} ${m.results.blocksSuffix}`}</Chip>
          </li>
        ) : null}
      </ul>
      <ResultsIsland
        plan={plan}
        diagrams={diagrams}
        messages={m}
        isCustomer={viewer.kind === 'customer'}
        shareUrl={`${site}/plan/results/${view.id}`}
        unlock={view.unlocked ? null : <UnlockIsland planId={view.id} mode={view.unlockMode} modelName={purposeModel?.name ?? ''} initialError={unlockError} messages={m.unlock} />}
      />
    </>
  );
}

/** /plan/results/[planId]: request-time (plan state, viewer), so everything below the heading streams in Suspense. */
export default function PlanResultsPage(props: Props) {
  const m = plantingRuntime().messages.results;
  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8">
      <h1 className="font-display text-4xl text-primary">{m.title}</h1>
      <Suspense
        fallback={
          <div className="space-y-4" aria-busy="true">
            <Skeleton className="h-8 w-80" />
            <Skeleton className="h-[480px] w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        }
      >
        <Results {...props} />
      </Suspense>
    </main>
  );
}
