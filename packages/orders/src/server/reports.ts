import { requirePermission } from '@ecomkit/core/auth-context';
import type { DateRange } from '@ecomkit/core/contracts';
import { db } from '@ecomkit/core/db';
import { sql, type SQL } from 'drizzle-orm';
import { cache } from 'react';

/**
 * Sales figures for the Home KPI cards and the sales reports. A sale is a real order (not a test, not a zero-value
 * replacement) that left `pending_payment` and was not cancelled; net sales subtract refunds. Days are IST.
 * Every function checks `analytics.read` (revenue is not for every role) and returns aggregates only, no personal data.
 */

const sale = (a: string): SQL => sql.raw(`${a}.is_test = false and ${a}.source <> 'replacement' and ${a}.status not in ('pending_payment', 'cancelled')`);
const SALE = sale('o');
const inRange = (r: DateRange): SQL =>
  sql`o.placed_at >= (${r.from}::date)::timestamp at time zone 'Asia/Kolkata' and o.placed_at < (${r.to}::date + 1)::timestamp at time zone 'Asia/Kolkata'`;

async function rows<T>(query: SQL): Promise<T[]> {
  return (await db.execute(query)).rows as T[];
}

export interface SalesDay {
  day: string;
  orders: number;
  salesPaise: number;
}

/** One row per IST day of the range (zero-filled). Cached per request: the three KPI cards share it. */
export const salesByDay = cache(async (from: string, to: string): Promise<SalesDay[]> => {
  await requirePermission('analytics.read');
  const r = { from, to };
  return rows<SalesDay>(sql`
    with d as (select generate_series(${from}::date, ${to}::date, interval '1 day')::date as day),
    s as (
      select (o.placed_at at time zone 'Asia/Kolkata')::date as day, count(*)::int as orders, coalesce(sum(o.total_paise - o.refunded_paise), 0)::float8 as sales
      from orders_order o where ${SALE} and ${inRange(r)} group by 1)
    select d.day::text as day, coalesce(s.orders, 0)::int as orders, coalesce(s.sales, 0)::float8 as "salesPaise"
    from d left join s on s.day = d.day order by d.day`);
});

export interface ProductSales {
  productId: string;
  name: string;
  qty: number;
  salesPaise: number;
  orders: number;
}

/** Best sellers by net line value over the range. */
export async function topProducts(range: DateRange, limit = 20): Promise<ProductSales[]> {
  await requirePermission('analytics.read');
  return rows<ProductSales>(sql`
    select l.product_id as "productId", max(l.product_snapshot->>'name') as name, sum(l.qty)::int as qty,
      sum(l.line_total_paise)::float8 as "salesPaise", count(distinct o.id)::int as orders
    from orders_line l join orders_order o on o.id = l.order_id
    where ${SALE} and ${inRange(range)} group by l.product_id order by 4 desc limit ${limit}`);
}

export interface ReturningSplit {
  firstTime: number;
  returning: number;
  guestOrders: number;
}

/** Signed-in customers who ordered in the range: first order ever in the range vs had an earlier sale. Guest orders counted apart. */
export async function returningCustomers(range: DateRange): Promise<ReturningSplit> {
  await requirePermission('analytics.read');
  const [r] = await rows<ReturningSplit>(sql`
    with c as (
      select o.customer_id, min(o.placed_at) as first_at from orders_order o
      where ${SALE} and ${inRange(range)} and o.customer_id is not null group by 1),
    f as (select exists (select 1 from orders_order p where p.customer_id = c.customer_id and p.placed_at < c.first_at and ${sale('p')}) as back from c)
    select (count(*) filter (where not back))::int as "firstTime", (count(*) filter (where back))::int as returning,
      (select count(*)::int from orders_order o where ${SALE} and ${inRange(range)} and o.customer_id is null) as "guestOrders"
    from f`);
  return r ?? { firstTime: 0, returning: 0, guestOrders: 0 };
}
