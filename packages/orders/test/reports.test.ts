import { ForbiddenError } from '@ecomkit/core/auth-context';
import { newId } from '@ecomkit/core/ids';
import type { TestDb } from '@ecomkit/core/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureOrders, markPaymentReceived } from '../src/server';
import { returningCustomers, salesByDay, topProducts } from '../src/server/reports';
import { orderInput, ordersDb, placeTestOrder } from './helpers';
import { asStaff } from './viewers';

let t: TestDb;
const DAY = '2026-03-10';
const returning = newId();
const lines = orderInput().lines; // the same two products on every order

/** Places an order at noon IST on `day`; `paid` records the full payment. */
async function order(day: string, opts: { paid?: boolean; customerId?: string | null } = {}) {
  const o = await placeTestOrder({ customerId: opts.customerId ?? null, lines });
  if (opts.paid) await markPaymentReceived({ orderId: o.id, amountPaise: 264_300, attemptId: newId() });
  await t.db.execute(sql`update orders_order set placed_at = ${`${day}T12:00:00+05:30`}::timestamptz where id = ${o.id}`);
  return o;
}

beforeAll(async () => {
  t = await ordersDb('reports');
  configureOrders({ inventory: null, discounts: null, payments: null, catalog: null });
  await order(DAY, { paid: true }); // a sale (guest)
  await order(DAY); // pending payment: not a sale
  const test = await order(DAY, { paid: true });
  await t.db.execute(sql`update orders_order set is_test = true where id = ${test.id}`); // test order: not a sale
  const refunded = await order(DAY, { paid: true, customerId: returning });
  await t.db.execute(sql`update orders_order set refunded_paise = 64_300 where id = ${refunded.id}`); // net of refunds
  await order('2026-03-01', { paid: true, customerId: returning }); // earlier sale: makes that customer returning
});
afterAll(async () => {
  await t?.close();
});

describe('sales reports', () => {
  it('count only real sales, net of refunds, on IST days', async () => {
    asStaff('manager');
    expect(await salesByDay('2026-03-09', DAY)).toEqual([
      { day: '2026-03-09', orders: 0, salesPaise: 0 },
      { day: DAY, orders: 2, salesPaise: 264_300 + 200_000 },
    ]);
    const top = await topProducts({ from: DAY, to: DAY });
    expect(top.map((p) => [p.name, p.qty, p.orders])).toEqual([
      ['Sapling A', 20, 2],
      ['Compost 25 kg', 2, 2],
    ]);
    expect(await returningCustomers({ from: DAY, to: DAY })).toEqual({ firstTime: 0, returning: 1, guestOrders: 1 });
  });

  it('are refused to roles without analytics.read', async () => {
    asStaff('support');
    await expect(salesByDay(DAY, DAY)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(topProducts({ from: DAY, to: DAY })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
