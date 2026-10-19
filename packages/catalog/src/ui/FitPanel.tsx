import type { ClimateFit, DistrictRef, FitLevel } from '@ecomkit/core/contracts';
import { cn } from '@ecomkit/ui';
import type { CatalogMessages } from '../messages';

const tone: Record<FitLevel, string> = { good: 'border-success text-success', ok: 'border-warning text-warning', not_recommended: 'border-danger text-danger' };

/** District fit on the PDP: all three levels with their reasons (cards never show not_recommended). */
export function FitPanel({ district, fit, messages, chooseHref }: { district: DistrictRef | null; fit: ClimateFit | null; messages: CatalogMessages; chooseHref: string | null }) {
  const m = messages.pdp;
  return (
    <section aria-labelledby="fit-title" className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4" data-fit={fit?.level ?? 'unknown'}>
      <h2 id="fit-title" className="font-display text-lg">
        {m.fitTitle}
      </h2>
      {district && fit ? (
        <>
          <p className={cn('border-l-4 pl-2 font-semibold', tone[fit.level])}>{m.fitLevel[fit.level](district.name)}</p>
          {fit.reasons.length ? (
            <ul className="list-disc pl-5 text-sm text-muted">
              {fit.reasons.flatMap((r) => (m.fitReasons[r] ? [<li key={r}>{m.fitReasons[r]}</li>] : []))}
            </ul>
          ) : null}
        </>
      ) : (
        <>
          <p className="text-sm text-muted">{m.fitPrompt}</p>
          {chooseHref ? (
            <a href={chooseHref} className="text-sm font-semibold text-primary underline" data-cta="pdp-fit-choose-district">
              {m.fitChoose}
            </a>
          ) : null}
        </>
      )}
    </section>
  );
}
