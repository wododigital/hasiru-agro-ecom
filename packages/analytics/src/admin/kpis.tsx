import type { DateRange } from '@ecomkit/core/contracts';
import { Kpi } from '@ecomkit/ui';
import { dailyKpis } from '../server/reports';

// KPI cards for the Home strip and the Analytics overview (dashboard widgets `analytics.kpi.*`).

type Props = { range: DateRange; compare?: DateRange | null };
const total = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

export async function SessionsKpi({ range, compare = null }: Props) {
  const [cur, prev] = await Promise.all([dailyKpis(range.from, range.to), compare ? dailyKpis(compare.from, compare.to) : null]);
  const n = total(cur.sessions);
  return (
    <Kpi
      label="Sessions"
      value={n.toLocaleString('en-IN')}
      current={n}
      previous={prev ? total(prev.sessions) : null}
      series={cur.sessions}
      href={`/admin/analytics/reports/analytics.sessions-by-source?from=${range.from}&to=${range.to}`}
    />
  );
}

/** Sessions with a tracked purchase over sessions (browser-tracked; order totals come from the orders cards). */
export async function ConversionKpi({ range, compare = null }: Props) {
  const [cur, prev] = await Promise.all([dailyKpis(range.from, range.to), compare ? dailyKpis(compare.from, compare.to) : null]);
  const rate = (k: { sessions: number[]; purchases: number[] }) => (total(k.sessions) ? total(k.purchases) / total(k.sessions) : 0);
  const r = rate(cur);
  return (
    <Kpi
      label="Conversion rate"
      value={`${(r * 100).toFixed(2)}%`}
      current={r}
      previous={prev ? rate(prev) : null}
      series={cur.sessions.map((s, i) => (s ? cur.purchases[i]! / s : 0))}
      href={`/admin/analytics/reports/analytics.conversion-funnel?from=${range.from}&to=${range.to}`}
    />
  );
}
