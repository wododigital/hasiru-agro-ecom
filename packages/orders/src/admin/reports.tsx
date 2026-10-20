import type { DateRange, Paise } from '@ecomkit/core/contracts';
import { formatINR } from '@ecomkit/core/money';
import { BarChart, Card, EmptyState, Kpi, TBody, THead, Table, Td, Th, Tr } from '@ecomkit/ui';
import { returningCustomers, salesByDay, topProducts, type SalesDay } from '../server/reports';

// Home KPI cards (`orders.kpi.*` dashboard widgets) and the sales reports (the `reports` point).
// Admin copy is English-only (exempt from the messages rule).

type Props = { range: DateRange; compare?: DateRange | null };
const rs = (p: number) => formatINR(Math.round(p) as Paise);
const sumOf = (days: readonly SalesDay[], k: 'orders' | 'salesPaise') => days.reduce((n, d) => n + d[k], 0);
const aov = (days: readonly SalesDay[]) => (sumOf(days, 'orders') ? sumOf(days, 'salesPaise') / sumOf(days, 'orders') : 0);
const report = (id: string, r: DateRange) => `/admin/analytics/reports/orders.${id}?from=${r.from}&to=${r.to}`;

async function load({ range, compare = null }: Props) {
  return Promise.all([salesByDay(range.from, range.to), compare ? salesByDay(compare.from, compare.to) : null]);
}

export async function SalesKpi(props: Props) {
  const [cur, prev] = await load(props);
  const n = sumOf(cur, 'salesPaise');
  return <Kpi label="Total sales" value={rs(n)} current={n} previous={prev && sumOf(prev, 'salesPaise')} series={cur.map((d) => d.salesPaise)} href={report('sales-over-time', props.range)} />;
}

export async function OrdersKpi(props: Props) {
  const [cur, prev] = await load(props);
  const n = sumOf(cur, 'orders');
  return <Kpi label="Orders" value={n.toLocaleString('en-IN')} current={n} previous={prev && sumOf(prev, 'orders')} series={cur.map((d) => d.orders)} href={report('sales-over-time', props.range)} />;
}

export async function AovKpi(props: Props) {
  const [cur, prev] = await load(props);
  const n = aov(cur);
  return (
    <Kpi label="Average order value" value={rs(n)} current={n} previous={prev && aov(prev)} series={cur.map((d) => (d.orders ? d.salesPaise / d.orders : 0))} href={report('average-order-value', props.range)} />
  );
}

function DayTable({ days, value }: { days: readonly SalesDay[]; value: [string, (d: SalesDay) => string][] }) {
  return (
    <Table>
      <THead>
        <Tr>
          <Th>Day</Th>
          {value.map(([h]) => (
            <Th key={h} className="text-right">
              {h}
            </Th>
          ))}
        </Tr>
      </THead>
      <TBody>
        {[...days].reverse().map((d) => (
          <Tr key={d.day}>
            <Td>{d.day}</Td>
            {value.map(([h, cell]) => (
              <Td key={h} className="text-right tabular-nums">
                {cell(d)}
              </Td>
            ))}
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}

/** Report: net sales and orders per day. */
export async function SalesOverTimeReport(props: Props) {
  const [cur, prev] = await load(props);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Kpi label="Total sales" value={rs(sumOf(cur, 'salesPaise'))} current={sumOf(cur, 'salesPaise')} previous={prev && sumOf(prev, 'salesPaise')} />
        <Kpi label="Orders" value={sumOf(cur, 'orders').toLocaleString('en-IN')} current={sumOf(cur, 'orders')} previous={prev && sumOf(prev, 'orders')} />
      </div>
      <Card title="Net sales per day">
        <BarChart values={cur.map((d) => d.salesPaise)} label={`Net sales per day, ${props.range.from} to ${props.range.to}`} width={720} height={140} className="h-auto w-full" />
      </Card>
      <DayTable days={cur} value={[['Orders', (d) => String(d.orders)], ['Net sales', (d) => rs(d.salesPaise)]]} />
    </div>
  );
}

/** Report: average order value per day. */
export async function AovReport(props: Props) {
  const [cur, prev] = await load(props);
  const perDay = (d: SalesDay) => (d.orders ? d.salesPaise / d.orders : 0);
  return (
    <div className="flex flex-col gap-4">
      <Kpi label="Average order value" value={rs(aov(cur))} current={aov(cur)} previous={prev && aov(prev)} />
      <Card title="Average order value per day">
        <BarChart values={cur.map(perDay)} label={`Average order value per day, ${props.range.from} to ${props.range.to}`} width={720} height={140} className="h-auto w-full" />
      </Card>
      <DayTable days={cur} value={[['Orders', (d) => String(d.orders)], ['Average order value', (d) => (d.orders ? rs(perDay(d)) : '-')]]} />
    </div>
  );
}

/** Report: best-selling products by net line value. */
export async function TopProductsReport({ range }: Props) {
  const rows = await topProducts(range);
  if (!rows.length) return <EmptyState title="No sales in this range" />;
  return (
    <Table>
      <THead>
        <Tr>
          <Th>Product</Th>
          <Th className="text-right">Quantity</Th>
          <Th className="text-right">Orders</Th>
          <Th className="text-right">Net sales</Th>
        </Tr>
      </THead>
      <TBody>
        {rows.map((p) => (
          <Tr key={p.productId}>
            <Td>{p.name}</Td>
            <Td className="text-right tabular-nums">{p.qty.toLocaleString('en-IN')}</Td>
            <Td className="text-right tabular-nums">{p.orders}</Td>
            <Td className="text-right tabular-nums">{rs(p.salesPaise)}</Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}

/** Report: first-time vs returning customers among those who ordered in the range. */
export async function ReturningCustomersReport({ range, compare = null }: Props) {
  const [cur, prev] = await Promise.all([returningCustomers(range), compare ? returningCustomers(compare) : null]);
  const rate = (s: { firstTime: number; returning: number }) => (s.firstTime + s.returning ? s.returning / (s.firstTime + s.returning) : 0);
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi label="Returning customer rate" value={`${(rate(cur) * 100).toFixed(1)}%`} current={rate(cur)} previous={prev && rate(prev)} />
      <Kpi label="Returning customers" value={String(cur.returning)} current={cur.returning} previous={prev?.returning ?? null} />
      <Kpi label="First-time customers" value={String(cur.firstTime)} current={cur.firstTime} previous={prev?.firstTime ?? null} />
      <Kpi label="Guest orders" value={String(cur.guestOrders)} current={cur.guestOrders} previous={prev?.guestOrders ?? null} />
    </div>
  );
}
