import type { DateRange } from '@ecomkit/core/contracts';
import { BarChart, Card, Kpi } from '@ecomkit/ui';
import { abandonedByDay } from '../server/admin';

// Abandoned checkouts report (the `reports` point, /admin/analytics/reports/flows.abandoned-checkouts). Admin copy is English-only.

type Days = Awaited<ReturnType<typeof abandonedByDay>>;
const total = (days: Days, k: 'started' | 'reminded' | 'recovered') => days.reduce((n, d) => n + d[k], 0);
const rate = (days: Days) => (total(days, 'reminded') ? total(days, 'recovered') / total(days, 'reminded') : 0);

export async function AbandonedCheckoutsReport({ range, compare = null }: { range: DateRange; compare?: DateRange | null }) {
  const [cur, prev] = await Promise.all([abandonedByDay(range), compare ? abandonedByDay(compare) : null]);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Abandoned checkouts" value={String(total(cur, 'started'))} current={total(cur, 'started')} previous={prev && total(prev, 'started')} lowerIsBetter />
        <Kpi label="Reminded" value={String(total(cur, 'reminded'))} current={total(cur, 'reminded')} previous={prev && total(prev, 'reminded')} />
        <Kpi label="Recovered" value={String(total(cur, 'recovered'))} current={total(cur, 'recovered')} previous={prev && total(prev, 'recovered')} />
        <Kpi label="Recovery rate" value={`${(rate(cur) * 100).toFixed(1)}%`} current={rate(cur)} previous={prev && rate(prev)} />
      </div>
      <Card title="Abandoned checkouts per day">
        <BarChart values={cur.map((d) => d.started)} label={`Abandoned checkouts per day, ${range.from} to ${range.to}`} width={720} height={140} className="h-auto w-full" />
      </Card>
    </div>
  );
}
