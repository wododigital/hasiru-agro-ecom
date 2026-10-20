import { vi } from 'vitest';
// DataTable's toolbar island reads the app router; outside Next there is none mounted.
vi.mock('next/navigation', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {}, prefetch: () => {} }),
  usePathname: () => '/admin/orders',
  useSearchParams: () => new URLSearchParams(),
}));
import { asCustomer, asGuest, asStaff } from './viewers';
import { ForbiddenError, NotFoundError } from '@ecomkit/core/auth-context';
import { newId } from '@ecomkit/core/ids';
import type { TestDb } from '@ecomkit/core/testing';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DispatchPage, ManualOrderPage, OrderDetailPage, OrdersListPage } from '../src/admin';
import AccountOrderPage from '../src/routes/account-order';
import { GET as accountInvoice } from '../src/routes/account-order-invoice';
import { GET as adminInvoice } from '../src/routes/admin-order-invoice';
import { GET as guestInvoice } from '../src/routes/order-token-invoice';
import {
  configureOrders,
  getMyOrder,
  getOrderByToken,
  issueInvoice,
  listMyOrders,
  listOrdersAdmin,
  markPaymentReceived,
  orderForBuyer,
  transition,
} from '../src/server';
import { OrdersListView, OrderView } from '../src/ui';
import { ordersDb, placeTestOrder } from './helpers';

let t: TestDb;
const customerA = newId();
const customerB = newId();
let mine: Awaited<ReturnType<typeof placeTestOrder>>;
let guestOrder: Awaited<ReturnType<typeof placeTestOrder>>;
const html = async (el: ReactElement | Promise<ReactElement>) => renderToStaticMarkup(await el);
const req = new Request('http://localhost/x');

beforeAll(async () => {
  t = await ordersDb('access');
  configureOrders({ inventory: null, discounts: null, payments: null, catalog: null });
  mine = await placeTestOrder({ customerId: customerA, delivery: { methodId: 'local', kind: 'local_slot', label: 'Local delivery', slotDate: '2099-01-03', vehicle: 'Small pickup' } });
  await markPaymentReceived({ orderId: mine.id, amountPaise: 264_300, attemptId: 'acc-1' });
  await issueInvoice(mine.id);
  guestOrder = await placeTestOrder();
});
afterAll(async () => {
  await t?.close();
});
beforeEach(() => asGuest());

describe('IDOR: customers only reach their own orders', () => {
  it('owner reads the order; another customer and a guest get NotFound', async () => {
    asCustomer(customerA);
    expect((await getMyOrder(mine.id)).order.id).toBe(mine.id);
    expect((await listMyOrders()).map((o) => o.id)).toEqual([mine.id]);
    asCustomer(customerB);
    await expect(getMyOrder(mine.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getMyOrder(guestOrder.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getMyOrder('not-a-uuid')).rejects.toBeInstanceOf(NotFoundError);
    expect(await listMyOrders()).toEqual([]);
    asGuest();
    await expect(getMyOrder(mine.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await listMyOrders()).toEqual([]);
  });

  it('the account order page 404s for anyone but the owner', async () => {
    asCustomer(customerB);
    await expect(AccountOrderPage({ params: Promise.resolve({ id: mine.id }) })).rejects.toMatchObject({ digest: expect.stringContaining('404') });
    asCustomer(customerA);
    expect(await html(AccountOrderPage({ params: Promise.resolve({ id: mine.id }) }))).toContain(mine.number);
  });

  it('invoice downloads: owner gets the PDF, others 404', async () => {
    asCustomer(customerB);
    expect((await accountInvoice(req, { params: Promise.resolve({ id: mine.id }) })).status).toBe(404);
    asCustomer(customerA);
    const res = await accountInvoice(req, { params: Promise.resolve({ id: mine.id }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('guest token: the right token opens the order, a wrong one opens nothing', async () => {
    expect((await getOrderByToken(guestOrder.guestToken))?.order.id).toBe(guestOrder.id);
    expect(await getOrderByToken('x'.repeat(32))).toBeNull();
    expect(await getOrderByToken('../etc')).toBeNull();
    expect((await guestInvoice(req, { params: Promise.resolve({ token: guestOrder.guestToken }) })).status).toBe(404); // unpaid: no invoice yet
    expect((await guestInvoice(req, { params: Promise.resolve({ token: mine.guestToken }) })).status).toBe(200);
    expect(await orderForBuyer(guestOrder.id, 'wrong-token-wrong-token')).toBeNull();
    expect((await orderForBuyer(guestOrder.id, guestOrder.guestToken))?.id).toBe(guestOrder.id);
    asCustomer(customerA);
    expect((await orderForBuyer(mine.id, null))?.id).toBe(mine.id);
    asCustomer(customerB);
    expect(await orderForBuyer(mine.id, null)).toBeNull();
  });
});

describe('admin access', () => {
  it('needs orders.read; support sees masked contact details, managers see them in full', async () => {
    await expect(listOrdersAdmin({ view: 'all' })).rejects.toBeInstanceOf(ForbiddenError);
    asCustomer(customerA);
    await expect(listOrdersAdmin({ view: 'all' })).rejects.toBeInstanceOf(ForbiddenError);
    asStaff('catalog_editor');
    await expect(listOrdersAdmin({ view: 'all' })).rejects.toBeInstanceOf(ForbiddenError);
    asStaff('support');
    const masked = (await listOrdersAdmin({ view: 'all' })).rows.find((o) => o.id === mine.id)!;
    expect((masked.contact as { phone: string }).phone).not.toBe('+919876543210');
    expect((masked.contact as { phone: string }).phone).toContain('•');
    asStaff('manager');
    const full = (await listOrdersAdmin({ view: 'all' })).rows.find((o) => o.id === mine.id)!;
    expect((full.contact as { phone: string }).phone).toBe('+919876543210');
    expect((await adminInvoice(req, { params: Promise.resolve({ id: mine.id }) })).status).toBe(200);
    asStaff('catalog_editor');
    expect((await adminInvoice(req, { params: Promise.resolve({ id: mine.id }) })).status).toBe(404);
  });

  it('saved views filter the list', async () => {
    asStaff('manager');
    const ids = async (view: Parameters<typeof listOrdersAdmin>[0]['view']) => (await listOrdersAdmin({ view })).rows.map((o) => o.id);
    expect(await ids('pending_payment')).toContain(guestOrder.id);
    expect(await ids('pending_payment')).not.toContain(mine.id);
    expect(await ids('unfulfilled')).toContain(mine.id);
    expect(await ids('replacements')).toEqual([]);
    expect(await ids('todays_slot')).not.toContain(mine.id);
    expect((await listOrdersAdmin({ view: 'todays_slot', now: new Date('2099-01-03T09:00:00+05:30') })).rows.map((o) => o.id)).toContain(mine.id);
    expect((await listOrdersAdmin({ view: 'all', q: mine.number })).rows.map((o) => o.id)).toEqual([mine.id]);
  });
});

describe('pages render', () => {
  it('admin list, detail, dispatch planner and manual order form', async () => {
    asStaff('manager');
    expect(await html(OrdersListPage({ searchParams: { view: 'unfulfilled' } }))).toContain(mine.number);
    const detail = await html(OrderDetailPage({ id: mine.id, flags: { done: '1' } }));
    expect(detail).toContain('Confirm');
    expect(detail).toContain('Timeline');
    expect(detail).toContain('invoice.pdf');
    const plan = await html(DispatchPage({ now: new Date('2099-01-01T09:00:00+05:30') }));
    expect(plan).toContain(mine.number);
    expect(plan).toContain('45 kg');
    expect(await html(ManualOrderPage({ flags: {} }))).toContain('Create order');
    asStaff('support');
    await expect(DispatchPage()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('customer views show the order, delivery date and invoice link', async () => {
    asCustomer(customerA);
    const detail = await getMyOrder(mine.id);
    const out = renderToStaticMarkup(<OrderView detail={detail} invoiceHref="/inv.pdf" />);
    expect(out).toContain('Rs 2,643');
    expect(out).toContain('Saturday 3 Jan');
    expect(out).toContain('/inv.pdf');
    expect(renderToStaticMarkup(<OrdersListView orders={await listMyOrders()} />)).toContain(mine.number);
    expect(renderToStaticMarkup(<OrdersListView orders={[]} />)).toContain('No orders yet');
  });

  it('delivered orders offer a replacement; other moves follow the machine', async () => {
    const actor = { type: 'staff' as const, id: newId(), permissions: ['orders.write', 'orders.dispatch'] as const };
    for (const to of ['confirmed', 'packed', 'dispatched', 'delivered'] as const) await transition(mine.id, to, { actor: { ...actor, permissions: [...actor.permissions] } });
    asStaff('fulfilment');
    expect(await html(OrderDetailPage({ id: mine.id, flags: {} }))).toContain('Create zero-value replacement');
  });
});
