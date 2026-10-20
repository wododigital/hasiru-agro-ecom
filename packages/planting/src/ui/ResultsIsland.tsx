'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import type { Paise, Role } from '@ecomkit/core/contracts';
import { Badge, Button, buttonVariants, Checkbox, cn, ImageWithFallback, Input, Price, QtyStepper, Select, toast } from '@ecomkit/ui';
import { unitAt, whatsappShareUrl } from '../domain/recommend';
import type { PlantingMessages } from '../messages';
import type { InputLine } from '../server/runtime';
import type { LineView, ModelView, PlanView } from '../server/plans';
import { addPackageAction, inputsAction, saveLandAction } from './actions';
import { ROLE_BG } from './roles';

export type ClientModel = Omit<ModelView, 'layout'> & { perBlockTotal: number };
export type ClientPlan = Omit<PlanView, 'models'> & { models: ClientModel[] };

type Qtys = Record<string, number>;

const qtyOf = (lines: readonly LineView[]): Qtys => Object.fromEntries(lines.map((l) => [l.productId, l.recommendedQty ?? 0]));
const inputQtys = (inputs: readonly InputLine[]): Qtys => Object.fromEntries(inputs.map((i) => [i.variantId, i.qty]));

export interface ResultsIslandProps {
  plan: ClientPlan;
  /** Server-rendered SVG plans keyed by model slug. */
  diagrams: Record<string, ReactNode>;
  /** The unlock card, rendered over the blurred preview while the plan is locked. */
  unlock: ReactNode | null;
  messages: PlantingMessages;
  isCustomer: boolean;
  shareUrl: string;
}

/**
 * Recommendations: purpose dropdown (chosen model first and open), one expandable section per model with the plan,
 * plant cards grouped by catalogue group (role pill, editable quantity with the recommended hint, price with bulk
 * state, details, alternates), recommended inputs that follow plant edits until edited by hand, and the package
 * footer. While locked the sections render blurred, without quantities or prices, under the unlock card.
 */
export function ResultsIsland({ plan, diagrams, unlock, messages, isCustomer, shareUrl }: ResultsIslandProps) {
  const m = messages.results;
  const [purpose, setPurpose] = useState(plan.purpose);
  const [open, setOpen] = useState<Record<string, boolean>>({ [plan.purpose]: true });
  const ordered = useMemo(() => [...plan.models].sort((a, b) => Number(b.slug === purpose) - Number(a.slug === purpose)), [plan.models, purpose]);
  const locked = !plan.unlocked;

  const choose = (slug: string) => {
    setPurpose(slug);
    setOpen((o) => ({ ...o, [slug]: true }));
  };

  const body = (
    <div className="space-y-6">
      {ordered.map((model) => (
        <ModelSection
          key={model.slug}
          model={model}
          plan={plan}
          chosen={model.slug === purpose}
          open={!!open[model.slug]}
          onToggle={(v) => setOpen((o) => ({ ...o, [model.slug]: v }))}
          diagram={diagrams[model.slug]}
          messages={messages}
          locked={locked}
        />
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="plan-purpose" className="text-sm font-semibold">
          {m.purpose}
        </label>
        <Select id="plan-purpose" value={purpose} onChange={(e) => choose(e.target.value)} className="w-auto" data-cta="plan-purpose">
          {plan.models.map((x) => (
            <option key={x.slug} value={x.slug}>
              {x.name}
            </option>
          ))}
        </Select>
      </div>

      {locked ? (
        <div className="relative">
          <div inert aria-hidden="true" className="pointer-events-none max-h-[900px] overflow-hidden blur-[7px] select-none">
            {body}
          </div>
          <div className="absolute inset-x-0 top-8 flex justify-center px-2">{unlock}</div>
        </div>
      ) : (
        body
      )}

      {locked ? null : <Extras plan={plan} messages={messages} isCustomer={isCustomer} shareUrl={shareUrl} />}
    </div>
  );
}

function ModelSection({
  model,
  plan,
  chosen,
  open,
  onToggle,
  diagram,
  messages,
  locked,
}: {
  model: ClientModel;
  plan: ClientPlan;
  chosen: boolean;
  open: boolean;
  onToggle: (open: boolean) => void;
  diagram: ReactNode;
  messages: PlantingMessages;
  locked: boolean;
}) {
  const m = messages.results;
  const router = useRouter();
  const [qty, setQty] = useState<Qtys>(() => qtyOf(model.lines));
  const [shownAlt, setShownAlt] = useState<Record<string, boolean>>({});
  const [inputs, setInputs] = useState<InputLine[]>(model.inputs);
  const [inQty, setInQty] = useState<Qtys>(() => inputQtys(model.inputs));
  const [handEdited, setHandEdited] = useState<Record<string, boolean>>({});
  const [include, setInclude] = useState(plan.inputsIncluded);
  const [pending, start] = useTransition();
  const first = useRef(true);

  const all = useMemo(() => [...model.lines, ...model.alternates], [model.lines, model.alternates]);
  const recommended = useMemo(() => qtyOf(model.lines), [model.lines]);
  const visible = all.filter((l) => !model.alternates.includes(l) || shownAlt[l.role] || (qty[l.productId] ?? 0) > 0);
  const groups = useMemo(() => {
    const map = new Map<string, LineView[]>();
    for (const l of visible) map.set(l.facts.group, [...(map.get(l.facts.group) ?? []), l]);
    return [...map.entries()];
  }, [visible]);

  // Inputs follow plant edits until the visitor edits an input by hand (debounced server call).
  useEffect(() => {
    if (locked || first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(async () => {
      const lines = Object.entries(qty).map(([productId, q]) => ({ productId, qty: q }));
      const next = await inputsAction({ planId: plan.id, model: model.slug, lines });
      setInputs(next);
      setInQty((cur) => ({ ...inputQtys(next), ...Object.fromEntries(Object.entries(cur).filter(([k]) => handEdited[k])) }));
    }, 400);
    return () => clearTimeout(timer);
  }, [qty, locked, plan.id, model.slug, handEdited]);

  const lineTotal = (l: LineView) => (l.price ? unitAt(l.price, qty[l.productId] ?? 0).unitPaise * (qty[l.productId] ?? 0) : 0);
  const plantsTotal = Object.values(qty).reduce((s, q) => s + q, 0);
  const inputsTotal = include ? inputs.reduce((s, i) => s + (i.unitPaise ?? 0) * (inQty[i.variantId] ?? 0), 0) : 0;
  const total = all.reduce((s, l) => s + lineTotal(l), 0) + inputsTotal;
  // No prices at all (pricing not configured): show no total rather than Rs 0.
  const priced = all.some((l) => l.price) || (include && inputs.some((i) => i.unitPaise !== null));

  const addPackage = () =>
    start(async () => {
      const r = await addPackageAction({
        planId: plan.id,
        model: model.slug,
        lines: Object.entries(qty).map(([productId, q]) => ({ productId, qty: q })),
        inputs: include ? Object.entries(inQty).map(([variantId, q]) => ({ variantId, qty: q })) : [],
      });
      if (r.status === 'added') {
        toast.success(m.added);
        router.push('/cart');
      } else toast.error(r.status === 'cart_unavailable' ? m.cartUnavailable : r.status === 'locked' ? m.unlockFirst : messages.unlock.failed);
    });

  return (
    <details open={open} onToggle={(e) => onToggle((e.target as HTMLDetailsElement).open)} className="group rounded-lg border border-border bg-surface shadow-card" data-model={model.slug}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block text-xs font-semibold tracking-wide text-accent uppercase">{chosen ? m.recommended : m.alsoExplore}</span>
          <span className="block font-display text-2xl text-primary">
            {model.name} {m.modelSuffix}
          </span>
          <span className="block text-sm text-muted tabular-nums">
            {locked ? m.hidden : plantsTotal} {m.plants}
            {locked || !priced ? null : (
              <>
                {' · '}
                <Price paise={total as Paise} size="sm" />
              </>
            )}
          </span>
        </span>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6 shrink-0 fill-none stroke-primary stroke-2 transition-transform group-open:rotate-180">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>

      <div className="space-y-6 border-t border-border p-5">
        {model.descriptionHtml ? (
          // eslint-disable-next-line react/no-danger -- sanitised with core safeHtml when saved
          <div className="prose max-w-3xl text-sm text-muted" dangerouslySetInnerHTML={{ __html: model.descriptionHtml }} />
        ) : null}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,560px)_1fr] lg:items-start">
          {diagram}
          <div className="space-y-3 text-sm">
            <p>
              <b className="tabular-nums">{model.perBlockTotal}</b> {m.scaleCaptionA} <b className="tabular-nums">{locked ? m.hidden : plantsTotal}</b> {m.scaleCaptionB}
            </p>
            <p className="text-muted tabular-nums">
              {model.isLine ? `${Math.round(plan.boundaryFt)} ${m.lineSuffix}` : `${model.blocks.toFixed(1)} ${m.blocksSuffix}`}
            </p>
            {model.isLine && plan.boundaryEstimated ? <p className="text-muted">{m.estimatedBoundary}</p> : null}
            {model.emptyRoles.length ? <p className="text-warning">{m.emptyRole}</p> : null}
            <div className="flex flex-wrap gap-2">
              {plan.has3d ? (
                <Link href={`/models/${model.slug}/3d?plan=${plan.id}`} prefetch={false} onPointerEnter={() => router.prefetch(`/models/${model.slug}/3d`)} onFocus={() => router.prefetch(`/models/${model.slug}/3d`)} className={buttonVariants({ variant: 'outline', size: 'sm' })} data-cta="plan-view-3d">
                  {m.view3d}
                </Link>
              ) : null}
              {model.videos.map((v) => (
                <a key={v.id} href={v.url} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'subtle', size: 'sm' })} data-cta="plan-watch-video">
                  {m.watch} {v.title}
                </a>
              ))}
            </div>
          </div>
        </div>

        {groups.map(([group, lines]) => (
          <section key={group || 'other'} className="space-y-3">
            <h3 className="font-display text-xl text-primary">
              {group} <span className="text-sm text-muted tabular-nums">{locked ? null : `· ${lines.reduce((s, l) => s + (qty[l.productId] ?? 0), 0)} ${m.plants}`}</span>
            </h3>
            <ul className="flex snap-x gap-3 overflow-x-auto pb-2">
              {lines.map((l) => (
                <PlantCard key={l.productId} line={l} qty={qty[l.productId] ?? 0} recommended={recommended[l.productId] ?? 0} locked={locked} messages={messages} onQty={(n) => setQty((q) => ({ ...q, [l.productId]: n }))} total={lineTotal(l)} />
              ))}
            </ul>
          </section>
        ))}
        {locked
          ? null
          : (['M', 'X', 'O'] as Role[])
              .filter((r) => model.alternates.some((a) => a.role === r))
              .map((r) => (
                <Button key={r} type="button" variant="ghost" size="sm" onClick={() => setShownAlt((s) => ({ ...s, [r]: !s[r] }))} aria-expanded={!!shownAlt[r]} data-cta="plan-more-varieties">
                  {shownAlt[r] ? m.viewLess : m.viewMore} · {messages.roles[r]}
                </Button>
              ))}

        {!locked && inputs.length ? (
          <section className={cn('space-y-3 rounded-md bg-surface-2 p-4 transition-opacity', !include && 'opacity-60')}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-display text-xl text-primary">{m.inputsTitle}</h3>
              <label className="flex items-center gap-2 text-sm font-semibold">
                <Checkbox checked={include} onChange={(e) => setInclude(e.target.checked)} data-cta="plan-inputs-include" />
                {m.inputsInclude}
              </label>
            </div>
            <p className="text-sm text-muted">{m.inputsNote}</p>
            <ul className="space-y-2">
              {inputs.map((i) => (
                <li key={i.variantId} className="flex flex-wrap items-center justify-between gap-3 rounded-sm bg-surface p-3">
                  <span>
                    <span className="font-semibold">{i.name}</span> {i.packLabel ? <span className="text-sm text-muted">{i.packLabel}</span> : null}
                    {i.unitPaise !== null ? <Price paise={i.unitPaise as Paise} size="sm" className="ml-2" /> : null}
                    {handEdited[i.variantId] && inQty[i.variantId] !== i.qty ? (
                      <span className="ml-2 text-xs text-muted">
                        ({m.suggested} {i.qty})
                      </span>
                    ) : null}
                  </span>
                  <QtyStepper value={inQty[i.variantId] ?? 0} onChange={(n) => (setInQty((q) => ({ ...q, [i.variantId]: n })), setHandEdited((h) => ({ ...h, [i.variantId]: true })))} itemName={i.name} quickChips={false} disabled={!include} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {locked ? null : (
          <div className="sticky bottom-2 z-10 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface p-4 shadow-card">
            <span className="text-sm">
              {model.name} {priced ? <>· {m.packageTotal} <Price paise={total as Paise} size="lg" /></> : null}
            </span>
            <div className="flex flex-col items-end gap-1">
              <Button type="button" variant="accent" onClick={addPackage} disabled={pending || !plan.cartEnabled || plantsTotal === 0} data-cta="plan-add-package">
                {pending ? m.adding : m.addPackage}
              </Button>
              <span className="text-xs text-muted">{plan.cartEnabled ? m.replaceNote : m.cartUnavailable}</span>
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

function PlantCard({ line, qty, recommended, locked, messages, onQty, total }: { line: LineView; qty: number; recommended: number; locked: boolean; messages: PlantingMessages; onQty: (n: number) => void; total: number }) {
  const m = messages.results;
  const [details, setDetails] = useState(false);
  const f = line.facts;
  const unit = line.price ? unitAt(line.price, Math.max(1, qty)) : null;
  const tier = line.price?.tier ?? line.price?.nextTier ?? null;
  return (
    <li className="w-64 shrink-0 snap-start rounded-md border border-border bg-surface p-3">
      <div className="flex gap-3">
        <div className="relative size-16 shrink-0 overflow-hidden rounded-sm">
          <ImageWithFallback image={f.image} alt="" fill sizes="64px" className="object-cover" />
        </div>
        <div className="min-w-0 space-y-1">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
            <span aria-hidden="true" className={cn('size-2.5 rounded-full', ROLE_BG[line.role])} />
            {line.role} · {messages.roles[line.role]}
          </span>
          <p className="truncate font-semibold text-primary" title={f.name}>
            {f.name}
          </p>
          {f.subcategory ? <p className="text-xs text-muted">{f.subcategory}</p> : null}
        </div>
      </div>
      {locked ? (
        <p className="mt-3 text-sm text-muted">{m.hidden}</p>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="flex flex-wrap items-center gap-1 text-sm">
            {unit ? <Price paise={unit.unitPaise as Paise} size="sm" /> : null} {unit ? m.each : null}
            {unit?.bulk ? <Badge tone="accent">{m.bulk}</Badge> : tier ? <span className="text-xs text-muted">
                · {m.bulkFrom} {tier.minQty}
              </span> : null}
          </p>
          {qty !== recommended && recommended > 0 ? (
            <p className="text-xs text-muted">
              {m.recommendedQty} {recommended}
            </p>
          ) : null}
          <div className="flex items-end justify-between gap-2">
            <QtyStepper value={qty} onChange={onQty} itemName={f.name} quickChips={false} cta="plan-card-qty" />
            {total ? <Price paise={total as Paise} size="sm" /> : null}
          </div>
          <button type="button" className="text-xs font-semibold text-primary underline" aria-expanded={details} onClick={() => setDetails((d) => !d)}>
            {m.details}
          </button>
          {details ? (
            <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
              {f.bearingYearsMin !== null ? (
                <>
                  <dt className="text-muted">{m.bears}</dt>
                  <dd>
                    {f.bearingYearsMin} {m.years}
                  </dd>
                </>
              ) : null}
              {f.yieldText ? (
                <>
                  <dt className="text-muted">{m.yield}</dt>
                  <dd>{f.yieldText}</dd>
                </>
              ) : null}
              <dd className="col-span-2">
                <Link href={f.href} className="font-semibold text-primary underline" data-cta="plan-open-product">
                  {m.openProduct}
                </Link>
              </dd>
            </dl>
          ) : null}
        </div>
      )}
    </li>
  );
}

function Extras({ plan, messages, isCustomer, shareUrl }: { plan: ClientPlan; messages: PlantingMessages; isCustomer: boolean; shareUrl: string }) {
  const m = messages.results;
  const [label, setLabel] = useState(m.saveLandDefault);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="space-y-2 rounded-lg border border-border bg-surface p-5">
        <h2 className="font-display text-xl text-primary">{m.somethingElse}</h2>
        <p className="text-sm text-muted">{m.somethingElseText}</p>
        <Link href="/plants" className={buttonVariants({ variant: 'outline', size: 'sm' })} data-cta="plan-browse-all">
          {m.browseAll}
        </Link>
      </section>
      <section className="space-y-2 rounded-lg border border-border bg-surface p-5">
        <h2 className="font-display text-xl text-primary">{m.buildForMe}</h2>
        <p className="text-sm text-muted">{m.buildForMeText}</p>
        <div className="flex flex-wrap gap-2">
          <Link href={plan.buildForMeHref} className={buttonVariants({ size: 'sm' })} data-cta="plan-build-for-me">
            {m.buildForMe}
          </Link>
          <a href={whatsappShareUrl(m.shareText, shareUrl)} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'outline', size: 'sm' })} data-cta="plan-share-whatsapp">
            {m.share}
          </a>
        </div>
      </section>
      {isCustomer ? (
        <section className="space-y-2 rounded-lg border border-border bg-surface p-5 md:col-span-2">
          <h2 className="font-display text-xl text-primary">{m.saveLand}</h2>
          {saved ? (
            <p role="status" className="text-sm text-success">
              {m.saved}
            </p>
          ) : (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                start(async () => setSaved((await saveLandAction({ planId: plan.id, label })).ok));
              }}
            >
              <label className="space-y-1 text-sm">
                <span className="block font-semibold">{m.saveLandLabel}</span>
                <Input value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} />
              </label>
              <Button type="submit" variant="outline" disabled={pending} data-cta="plan-save-land">
                {m.saveLand}
              </Button>
            </form>
          )}
        </section>
      ) : null}
    </div>
  );
}
