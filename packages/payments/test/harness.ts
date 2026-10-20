// Test harness: a real HTTP server on a random port serving the mock gateway and our webhook route at the paths
// the app uses, so the client talks HTTP end to end and the mock posts authenticated webhooks back to us.
// The orders module is not part of this package: FakeOrders implements the orders port in memory.
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Paise } from '@ecomkit/core/contracts';
import { resetEnv } from '@ecomkit/core/env';
import { newId } from '@ecomkit/core/ids';
import { ensureQueue, getBoss } from '@ecomkit/core/jobs';
import * as mock from '../src/mocks/phonepe';
import type { PaymentMethod } from '../src/domain';
import { configurePayments, type PaymentOrder, type PaymentsAlert, type PaymentsOrdersPort } from '../src/server/ports';
import { receiveWebhook } from '../src/server/webhook';

type Handler = (req: Request) => Promise<Response>;

function route(method: string, path: string): Handler | null {
  if (path.startsWith('/api/_mock/phonepe/')) return method === 'GET' ? mock.GET : mock.POST;
  if (path === '/api/webhooks/phonepe' && method === 'POST') return receiveWebhook;
  // Settings writes ask the web process to expire their cache tag; nothing is cached here.
  if (path === '/api/internal/revalidate') return async () => new Response(null, { status: 204 });
  return null;
}

export async function startHarness(): Promise<{ origin: string; close(): Promise<void> }> {
  const server: Server = createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const url = new URL(req.url ?? '/', origin);
    const handler = route(req.method ?? 'GET', url.pathname);
    if (!handler) {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    try {
      const response = await handler(new Request(url, { method: req.method, headers, ...(body && req.method !== 'GET' ? { body } : {}) }));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.INTERNAL_BASE_URL = origin;
  resetEnv();
  return { origin, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/** Env every test file needs before createTestDb. */
export function testEnv(): void {
  process.env.INTERNAL_SECRET = 'p'.repeat(40);
  process.env.SETTINGS_MASTER_KEY = `1:${randomBytes(32).toString('base64')}`;
  process.env.ENABLE_MOCKS = '1';
  delete process.env.SITE_URL;
  resetEnv();
}

export async function createQueues(): Promise<void> {
  const boss = await getBoss();
  for (const q of ['payments.process-webhook', 'core.event']) await ensureQueue(boss, q);
}

/** In-memory orders module: the transition rules the real one must keep (only pending_payment moves). */
export class FakeOrders implements PaymentsOrdersPort {
  orders = new Map<string, PaymentOrder>();
  paid: { orderId: string; amountPaise: number; attemptId: string; method: PaymentMethod }[] = [];
  expired: { orderId: string; reason: string }[] = [];
  refunded: { orderId: string; refundId: string; amountPaise: number }[] = [];
  private seq = 0;

  add(totalPaise: number, patch: Partial<PaymentOrder> = {}): PaymentOrder {
    const o: PaymentOrder = {
      id: newId(),
      number: `T-2610-${String(++this.seq).padStart(5, '0')}`,
      status: 'pending_payment',
      totalPaise: totalPaise as Paise,
      paidPaise: 0 as Paise,
      isTest: false,
      contact: { name: 'Asha', phone: '+919876543210', email: null },
      ...patch,
    };
    this.orders.set(o.id, o);
    return o;
  }

  async get(orderId: string): Promise<PaymentOrder | null> {
    const o = this.orders.get(orderId);
    return o ? { ...o } : null;
  }

  /** Simulates the order being cancelled under its own lock between payments' read and markPaid. */
  refuseNextPayment = false;

  async markPaid(input: { orderId: string; amountPaise: Paise; attemptId: string; method: PaymentMethod }): Promise<void | { applied: boolean }> {
    if (this.refuseNextPayment) {
      this.refuseNextPayment = false;
      return { applied: false };
    }
    const o = this.orders.get(input.orderId)!;
    if (o.status !== 'pending_payment') throw new Error(`markPaid on ${o.status}`);
    o.status = 'paid';
    o.paidPaise = (o.paidPaise + input.amountPaise) as Paise;
    this.paid.push(input);
  }

  async paymentExpired(input: { orderId: string; reason: 'failed' | 'expired' }): Promise<void> {
    const o = this.orders.get(input.orderId);
    this.expired.push(input);
    if (o?.status === 'pending_payment') o.status = 'cancelled';
  }

  async markRefunded(input: { orderId: string; refundId: string; amountPaise: Paise }): Promise<void> {
    this.refunded.push(input);
  }

  async orderLink(orderId: string): Promise<string | null> {
    return `/order/guest-${orderId}`;
  }
}

/** Binds a fresh fake orders module and an alert recorder. */
export function bindPorts(): { orders: FakeOrders; alerts: PaymentsAlert[] } {
  const orders = new FakeOrders();
  const alerts: PaymentsAlert[] = [];
  configurePayments({ orders, alert: async (a) => void alerts.push(a) });
  return { orders, alerts };
}

export const STAFF_ID = '0192a000-0000-7000-8000-000000000001';
