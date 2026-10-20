import type { DateRange } from '@ecomkit/core/contracts';
import { Badge, BarChart, TBody, THead, Table, Td, Th, Tr } from '@ecomkit/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { vitalRating, type VitalMetric } from '../domain/reports';
import { report } from '../server/reports';

/** Props every report body receives from the report page (`params`: the page's string query values). */
export interface ReportProps {
  range: DateRange;
  compare?: DateRange | null;
  params?: Readonly<Record<string, string>>;
}

// Admin copy is English-only (exempt from the messages rule).

const num = (n: number) => Math.round(n).toLocaleString('en-IN');
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const secs = (ms: number) => `${num(ms / 1000)} s`;

type Col<T> = readonly [header: string, cell: (row: T) => ReactNode, align?: 'right'];

function Grid<T>({ title, rows, cols, empty = 'No data in this range yet.' }: { title: string; rows: readonly T[]; cols: readonly Col<T>[]; empty?: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold text-text">{title}</h2>
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted">{empty}</p>
      ) : (
        <Table>
          <THead>
            <tr>
              {cols.map(([h, , align]) => (
                <Th key={h} className={align === 'right' ? 'text-right' : undefined}>
                  {h}
                </Th>
              ))}
            </tr>
          </THead>
          <TBody>
            {rows.map((row, i) => (
              <Tr key={i}>
                {cols.map(([h, cell, align]) => (
                  <Td key={h} className={align === 'right' ? 'text-right tabular-nums' : 'max-w-[28rem] truncate'}>
                    {cell(row)}
                  </Td>
                ))}
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </section>
  );
}

/** Overview body under the KPI cards: sessions per day, channels, top pages. */
export async function OverviewCharts({ range }: { range: DateRange }) {
  const r = await report('overview', range);
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4">
        <h2 className="text-base font-semibold text-text">Sessions per day</h2>
        <BarChart values={r.series.map((s) => s.sessions)} label={`Sessions per day, ${range.from} to ${range.to}`} width={720} height={120} className="h-auto w-full" />
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <Grid title="Sessions by channel" rows={r.channels} cols={[['Channel', (x) => x.key], ['Sessions', (x) => num(x.value), 'right']]} />
        <Grid title="Top pages" rows={r.topPages} cols={[['Path', (x) => x.key], ['Views', (x) => num(x.value), 'right']]} />
      </div>
    </div>
  );
}

export async function FunnelTab({ range }: { range: DateRange }) {
  const r = await report('funnel', range);
  const top = r.steps[0]?.sessions ?? 0;
  return (
    <Grid
      title="Purchase funnel (sessions reaching each step in order)"
      rows={r.steps}
      cols={[
        ['Step', (s) => s.step.replaceAll('_', ' ')],
        ['Sessions', (s) => num(s.sessions), 'right'],
        ['From previous step', (s) => pct(s.rate), 'right'],
        ['From first step', (s) => (top ? pct(s.sessions / top) : '0.0%'), 'right'],
      ]}
    />
  );
}

export async function TrafficTab({ range }: { range: DateRange }) {
  const r = await report('traffic', range);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Grid title="Channels" rows={r.channels} cols={[['Channel', (x) => x.channel], ['Sessions', (x) => num(x.sessions), 'right']]} />
      <Grid title="Devices" rows={r.devices} cols={[['Device', (x) => x.device], ['Sessions', (x) => num(x.sessions), 'right']]} />
      <Grid title="New and returning" rows={r.visitorType} cols={[['Visitor', (x) => x.type], ['Sessions', (x) => num(x.sessions), 'right']]} />
      <Grid title="AI assistant referrals" rows={r.aiReferrals} cols={[['Source', (x) => x.host], ['Sessions', (x) => num(x.sessions), 'right']]} />
      <Grid title="Referrers" rows={r.referrers} cols={[['Host', (x) => x.host], ['Sessions', (x) => num(x.sessions), 'right']]} />
      <Grid title="Landing pages" rows={r.landingPages} cols={[['Path', (x) => x.path], ['Sessions', (x) => num(x.sessions), 'right']]} />
      <div className="lg:col-span-2">
        <Grid
          title="Campaigns"
          rows={r.campaigns}
          cols={[['Source', (x) => x.source ?? ''], ['Medium', (x) => x.medium ?? ''], ['Campaign', (x) => x.campaign ?? ''], ['Sessions', (x) => num(x.sessions), 'right']]}
        />
      </div>
    </div>
  );
}

export async function JourneysTab({ range, params = {} }: ReportProps) {
  const r = await report('journeys', range, { sessionId: params.session });
  const hrefFor = (id: string) => `?${new URLSearchParams({ ...params, from: range.from, to: range.to, session: id })}`;
  return (
    <div className="flex flex-col gap-6">
      {r.timeline ? (
        <Grid
          title="Session timeline"
          rows={r.timeline}
          cols={[['Time', (e) => new Date(e.at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })], ['Event', (e) => e.name], ['Path', (e) => e.path], ['Details', (e) => (e.props === '{}' ? '' : e.props)]]}
        />
      ) : null}
      <Grid title="Most common paths (first four pages)" rows={r.paths} cols={[['Path', (x) => x.path], ['Sessions', (x) => num(x.sessions), 'right']]} />
      <Grid
        title="Recent sessions"
        rows={r.recent}
        cols={[
          ['Started', (s) => new Date(s.started_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })],
          ['Landing', (s) => s.landing_path],
          ['Channel', (s) => s.channel],
          ['Device', (s) => s.device],
          ['Pages', (s) => num(s.pages), 'right'],
          ['Purchased', (s) => (s.converted ? <Badge tone="success">yes</Badge> : '')],
          ['', (s) => <Link className="text-primary-hover underline-offset-4 hover:underline" href={hrefFor(s.id)}>Timeline</Link>],
        ]}
      />
    </div>
  );
}

export async function SearchTab({ range }: { range: DateRange }) {
  const r = await report('search', range);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Grid title="Searches" rows={r.queries} cols={[['Query', (x) => x.query], ['Searches', (x) => num(x.searches), 'right'], ['No results', (x) => num(x.zero), 'right']]} />
      <Grid title="Searches with no results" rows={r.zeroResultQueries} cols={[['Query', (x) => x.query], ['Searches', (x) => num(x.searches), 'right']]} />
      <div className="lg:col-span-2">
        <Grid
          title="Filters used"
          rows={r.filters}
          cols={[['Filter', (x) => x.facet], ['Value', (x) => x.value], ['Uses', (x) => num(x.uses), 'right'], ['No results', (x) => num(x.zero), 'right']]}
        />
      </div>
    </div>
  );
}

export async function WizardTab({ range }: { range: DateRange }) {
  const r = await report('wizard', range);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Grid title="Wizard steps" rows={r.steps} cols={[['Step', (x) => x.step], ['Sessions', (x) => num(x.sessions), 'right']]} />
      <Grid title="Outcomes" rows={r.outcomes} cols={[['Event', (x) => x.name.replaceAll('_', ' ')], ['Events', (x) => num(x.events), 'right'], ['Sessions', (x) => num(x.sessions), 'right']]} />
      <Grid title="Calculators" rows={r.calculators} cols={[['Calculator', (x) => x.calculator], ['Uses', (x) => num(x.uses), 'right']]} />
    </div>
  );
}

export async function AttentionTab({ range }: { range: DateRange }) {
  const r = await report('attention', range);
  return (
    <div className="flex flex-col gap-6">
      <Grid
        title="Products: attention against add to cart (high attention, few adds = a product page to fix)"
        rows={r.products}
        cols={[['Product', (x) => x.product], ['Engaged', (x) => secs(x.engaged_ms), 'right'], ['Sessions', (x) => num(x.sessions), 'right'], ['Add to cart', (x) => num(x.add_to_cart), 'right']]}
      />
      <Grid
        title="Sections"
        rows={r.sections}
        cols={[['Path', (x) => x.path], ['Section', (x) => x.section], ['Visible', (x) => secs(x.visible_ms), 'right'], ['Engaged', (x) => secs(x.engaged_ms), 'right'], ['Sessions', (x) => num(x.sessions), 'right']]}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Grid title="Rage and dead clicks" rows={r.clicks} cols={[['Kind', (x) => x.kind.replace('_click', '')], ['Path', (x) => x.path], ['Target', (x) => x.target], ['Clicks', (x) => num(x.clicks), 'right']]} />
        <Grid title="CTA clicks" rows={r.ctas} cols={[['CTA', (x) => x.cta], ['Clicks', (x) => num(x.clicks), 'right']]} />
      </div>
      <Grid title="Scroll depth" rows={r.scroll} cols={[['Path', (x) => x.path], ['Reached', (x) => `${x.pct}%`, 'right'], ['Sessions', (x) => num(x.sessions), 'right']]} />
    </div>
  );
}

export async function BotsTab({ range }: { range: DateRange }) {
  const r = await report('bots', range);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Grid
        title="Automated visitors (excluded from every other report)"
        rows={r.bots}
        empty="No automated visitors ran the collector in this range."
        cols={[['Agent', (x) => x.bot], ['Sessions', (x) => num(x.sessions), 'right'], ['Events', (x) => num(x.events), 'right']]}
      />
      <Grid title="Visits from AI assistants" rows={r.aiReferrals} cols={[['Source', (x) => x.host], ['Sessions', (x) => num(x.sessions), 'right']]} />
    </div>
  );
}

const ratingTone = { good: 'success', 'needs-improvement': 'warning', poor: 'danger' } as const;
function VitalCell({ metric, value }: { metric: VitalMetric; value: number | undefined }) {
  if (value === undefined) return null;
  const shown = metric === 'CLS' ? value.toFixed(3) : `${num(value)} ms`;
  return <Badge tone={ratingTone[vitalRating(metric, value)]}>{shown}</Badge>;
}

export async function VitalsTab({ range }: { range: DateRange }) {
  const r = await report('vitals', range);
  return (
    <div className="flex flex-col gap-6">
      <Grid
        title="p75 by device (field data from real visitors)"
        rows={r.overall}
        cols={[['Metric', (x) => x.metric], ['Device', (x) => x.device], ['p75', (x) => <VitalCell metric={x.metric} value={Number(x.p75)} />, 'right'], ['Samples', (x) => num(x.samples), 'right']]}
      />
      <Grid
        title="p75 by page"
        rows={r.paths}
        cols={[['Path', (x) => x.path], ...r.metrics.map((m): Col<(typeof r.paths)[number]> => [m, (x) => <VitalCell metric={m} value={x[m]} />, 'right']), ['Samples', (x) => num(x.samples), 'right']]}
      />
    </div>
  );
}

