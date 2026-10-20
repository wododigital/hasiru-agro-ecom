// Mock payment gateway (OAuth token, pay, order status, refund, refund status, and a test pay page) for dev and
// tests. Route: /api/_mock/phonepe/[...path]. 404 unless ENABLE_MOCKS=1. State lives in this process only.
// The pay page's Success / Fail / Pending / Abandon buttons set the order state and post a correctly
// authenticated webhook to our real webhook route, then send the buyer back to the merchant redirect URL.
import { createHash, randomBytes } from 'node:crypto';
import { env } from '@ecomkit/core/env';
import { WEBHOOK_EVENTS } from '../domain';
import { loadSettings, webhookCredentials } from '../server/config';

interface MockOrder {
  merchantOrderId: string;
  orderId: string;
  amount: number;
  state: 'PENDING' | 'COMPLETED' | 'FAILED';
  redirectUrl: string;
  expireAt: number;
  /** Amount the status API and webhook report (tests set it to simulate a mismatch). */
  reportAmount: number | null;
  transactionId: string | null;
}
interface MockRefund {
  merchantRefundId: string;
  refundId: string;
  originalMerchantOrderId: string;
  amount: number;
  state: 'PENDING' | 'COMPLETED' | 'FAILED';
}
export interface PhonepeMockState {
  tokens: Map<string, number>;
  tokenCalls: number;
  statusCalls: number;
  orders: Map<string, MockOrder>;
  refunds: Map<string, MockRefund>;
  /** The next N gateway API calls (not token) answer 429. */
  rateLimitNext: number;
  tokenTtlSec: number;
  webhookDelayMs: number;
  /** Send every webhook twice (idempotency checks). */
  duplicateWebhooks: boolean;
  /** How the mock encodes the webhook Authorization hash. */
  hashEncoding: 'hex' | 'base64';
  refundAutoComplete: boolean;
  webhooks: { event: string; status: number }[];
  pending: Set<Promise<unknown>>;
}

const g = globalThis as unknown as { __ecomkitPhonepeMock?: PhonepeMockState };
export const phonepeMockState = (): PhonepeMockState =>
  (g.__ecomkitPhonepeMock ??= {
    tokens: new Map(),
    tokenCalls: 0,
    statusCalls: 0,
    orders: new Map(),
    refunds: new Map(),
    rateLimitNext: 0,
    tokenTtlSec: 60,
    webhookDelayMs: 0,
    duplicateWebhooks: false,
    hashEncoding: 'hex',
    refundAutoComplete: true,
    webhooks: [],
    pending: new Set(),
  });

export function resetPhonepeMock(): void {
  delete g.__ecomkitPhonepeMock;
}

/** Waits for every webhook the mock has scheduled (tests). */
export async function flushPhonepeMock(): Promise<void> {
  while (phonepeMockState().pending.size) await Promise.all([...phonepeMockState().pending]);
}

const enabled = () => process.env.ENABLE_MOCKS === '1';
const notFound = () => new Response(null, { status: 404 });
const err = (status: number, code: string, message: string) => Response.json({ code, message }, { status });
const base = () => env.INTERNAL_BASE_URL.replace(/\/$/, '');
const publicBase = () => (env.SITE_URL ?? env.INTERNAL_BASE_URL).replace(/\/$/, '');
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const MERCHANT_ID_RE = /^[A-Za-z0-9_-]{1,63}$/;

/** Signs and posts a webhook to our own endpoint, the way the gateway does. */
async function fireWebhook(event: string, payload: Record<string, unknown>): Promise<void> {
  const state = phonepeMockState();
  const creds = webhookCredentials(await loadSettings(), 'mock');
  const digest = createHash('sha256').update(`${creds?.username ?? ''}:${creds?.password ?? ''}`).digest(state.hashEncoding);
  const body = JSON.stringify({ event, payload });
  const send = async () => {
    const res = await fetch(`${base()}/api/webhooks/phonepe`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: digest }, body }).catch(() => null);
    state.webhooks.push({ event, status: res?.status ?? 0 });
  };
  const p: Promise<void> = new Promise<void>((r) => setTimeout(r, state.webhookDelayMs))
    .then(async () => {
      await send();
      if (state.duplicateWebhooks) await send();
    })
    .finally(() => state.pending.delete(p));
  state.pending.add(p);
}

const orderPayload = (o: MockOrder) => ({
  orderId: o.orderId,
  merchantOrderId: o.merchantOrderId,
  state: o.state,
  amount: o.reportAmount ?? o.amount,
  expireAt: o.expireAt,
  paymentDetails: o.transactionId ? [{ transactionId: o.transactionId, paymentMode: 'UPI_INTENT', state: o.state, amount: o.reportAmount ?? o.amount, timestamp: Date.now() }] : [],
});

/** Settles a mock order (pay page buttons, tests) and posts the matching webhook. Pending and abandon post nothing. */
export async function settleMockOrder(merchantOrderId: string, outcome: 'success' | 'fail' | 'pending' | 'abandon'): Promise<MockOrder | null> {
  const o = phonepeMockState().orders.get(merchantOrderId);
  if (!o) return null;
  if (outcome === 'success' || outcome === 'fail') {
    o.state = outcome === 'success' ? 'COMPLETED' : 'FAILED';
    o.transactionId = `MT${randomBytes(6).toString('hex').toUpperCase()}`;
    await fireWebhook(outcome === 'success' ? WEBHOOK_EVENTS.orderCompleted : WEBHOOK_EVENTS.orderFailed, orderPayload(o));
  }
  return o;
}

function authorised(req: Request): boolean {
  const m = /^O-Bearer (.+)$/.exec(req.headers.get('authorization') ?? '');
  const exp = m ? phonepeMockState().tokens.get(m[1]!) : undefined;
  return exp !== undefined && exp > Date.now();
}

function payPage(o: MockOrder): Response {
  const button = (outcome: string, label: string) =>
    `<button name="outcome" value="${outcome}" style="padding:12px 16px;border-radius:8px;border:1px solid gray;background:white;font:inherit;cursor:pointer">${label}</button>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Mock payment</title></head>
<body style="font-family:system-ui,sans-serif;max-width:420px;margin:40px auto;padding:0 16px">
<h1 style="font-size:20px">Mock payment page</h1>
<p>Order <code>${esc(o.merchantOrderId)}</code>, amount Rs ${(o.amount / 100).toFixed(2)}. State: ${esc(o.state)}.</p>
<form method="post" action="${esc(publicBase())}/api/_mock/phonepe/paypage" style="display:grid;gap:8px">
<input type="hidden" name="o" value="${esc(o.merchantOrderId)}">
${button('success', 'Success')}${button('fail', 'Fail')}${button('pending', 'Pending')}${button('abandon', 'Abandon')}
</form><p style="color:dimgray;font-size:13px">Local test gateway. No money moves.</p></body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

async function handle(req: Request): Promise<Response> {
  if (!enabled()) return notFound();
  const url = new URL(req.url);
  const path = url.pathname.split('/api/_mock/phonepe/')[1] ?? '';
  const state = phonepeMockState();

  if (path === '_control' && req.method === 'POST') {
    const body = (await req.json().catch(() => ({}))) as Partial<PhonepeMockState> & { reset?: boolean; settle?: { merchantOrderId: string; outcome: 'success' | 'fail' } };
    if (body.reset) resetPhonepeMock();
    const s = phonepeMockState();
    for (const k of ['rateLimitNext', 'tokenTtlSec', 'webhookDelayMs', 'duplicateWebhooks', 'hashEncoding', 'refundAutoComplete'] as const) {
      if (k in body) (s as unknown as Record<string, unknown>)[k] = body[k];
    }
    if (body.settle) await settleMockOrder(body.settle.merchantOrderId, body.settle.outcome);
    return Response.json({ ok: true });
  }

  if (path === 'v1/oauth/token' && req.method === 'POST') {
    state.tokenCalls++;
    const form = new URLSearchParams(await req.text());
    if (form.get('grant_type') !== 'client_credentials' || !form.get('client_id') || !form.get('client_secret')) return err(401, 'UNAUTHORIZED', 'bad client credentials');
    const token = randomBytes(16).toString('hex');
    const expiresAt = Math.floor(Date.now() / 1000) + state.tokenTtlSec;
    state.tokens.set(token, expiresAt * 1000);
    return Response.json({ access_token: token, encrypted_access_token: token, expires_in: null, issued_at: Math.floor(Date.now() / 1000), expires_at: expiresAt, token_type: 'O-Bearer' });
  }

  if (path === 'paypage') {
    if (req.method === 'GET') {
      const o = state.orders.get(url.searchParams.get('o') ?? '');
      return o ? payPage(o) : notFound();
    }
    const form = new URLSearchParams(await req.text());
    const outcome = form.get('outcome');
    if (outcome !== 'success' && outcome !== 'fail' && outcome !== 'pending' && outcome !== 'abandon') return err(400, 'BAD_REQUEST', 'unknown outcome');
    const o = await settleMockOrder(form.get('o') ?? '', outcome);
    if (!o) return notFound();
    await flushPhonepeMock(); // the webhook lands before the buyer is back
    return new Response(null, { status: 303, headers: { location: o.redirectUrl } });
  }

  // Gateway API calls below need a valid token.
  if (!authorised(req)) return err(401, 'UNAUTHORIZED', 'token missing or expired');
  if (state.rateLimitNext > 0) {
    state.rateLimitNext--;
    return err(429, 'TOO_MANY_REQUESTS', 'rate limited');
  }

  if (path === 'checkout/v2/pay' && req.method === 'POST') {
    const body = (await req.json().catch(() => null)) as {
      merchantOrderId?: string;
      amount?: number;
      expireAfter?: number;
      paymentFlow?: { type?: string; merchantUrls?: { redirectUrl?: string } };
    } | null;
    const id = body?.merchantOrderId ?? '';
    const redirectUrl = body?.paymentFlow?.merchantUrls?.redirectUrl ?? '';
    if (!MERCHANT_ID_RE.test(id)) return err(400, 'BAD_REQUEST', 'merchantOrderId invalid');
    if (!Number.isInteger(body?.amount) || body!.amount! < 100) return err(400, 'BAD_REQUEST', 'amount must be at least 100 paise');
    if (!body?.expireAfter || body.expireAfter < 300 || body.expireAfter > 3600) return err(400, 'BAD_REQUEST', 'expireAfter out of range');
    if (body.paymentFlow?.type !== 'PG_CHECKOUT' || !/^https?:\/\//.test(redirectUrl)) return err(400, 'BAD_REQUEST', 'paymentFlow invalid');
    if (state.orders.has(id)) return err(400, 'BAD_REQUEST', 'merchantOrderId already used');
    const o: MockOrder = {
      merchantOrderId: id,
      orderId: `OMO${randomBytes(8).toString('hex').toUpperCase()}`,
      amount: body.amount!,
      state: 'PENDING',
      redirectUrl,
      expireAt: Date.now() + body.expireAfter * 1000,
      reportAmount: null,
      transactionId: null,
    };
    state.orders.set(id, o);
    return Response.json({ orderId: o.orderId, state: o.state, expireAt: o.expireAt, redirectUrl: `${publicBase()}/api/_mock/phonepe/paypage?o=${encodeURIComponent(id)}` });
  }

  const status = /^checkout\/v2\/order\/([^/]+)\/status$/.exec(path);
  if (status && req.method === 'GET') {
    state.statusCalls++;
    const o = state.orders.get(decodeURIComponent(status[1]!));
    if (!o) return err(400, 'INVALID_MERCHANT_ORDER_ID', 'unknown merchantOrderId');
    return Response.json(orderPayload(o));
  }

  if (path === 'payments/v2/refund' && req.method === 'POST') {
    const body = (await req.json().catch(() => null)) as { merchantRefundId?: string; originalMerchantOrderId?: string; amount?: number } | null;
    const o = state.orders.get(body?.originalMerchantOrderId ?? '');
    const id = body?.merchantRefundId ?? '';
    if (!o || o.state !== 'COMPLETED') return err(400, 'BAD_REQUEST', 'original order not completed');
    if (!MERCHANT_ID_RE.test(id) || state.refunds.has(id)) return err(400, 'BAD_REQUEST', 'merchantRefundId invalid or reused');
    const already = [...state.refunds.values()].filter((r) => r.originalMerchantOrderId === o.merchantOrderId && r.state !== 'FAILED').reduce((s, r) => s + r.amount, 0);
    const captured = o.reportAmount ?? o.amount;
    if (!Number.isInteger(body?.amount) || body!.amount! < 100 || already + body!.amount! > captured) return err(400, 'BAD_REQUEST', 'refund amount exceeds the captured amount');
    const r: MockRefund = { merchantRefundId: id, refundId: `OMR${randomBytes(8).toString('hex').toUpperCase()}`, originalMerchantOrderId: o.merchantOrderId, amount: body!.amount!, state: 'PENDING' };
    state.refunds.set(id, r);
    if (state.refundAutoComplete) {
      r.state = 'COMPLETED';
      await fireWebhook(WEBHOOK_EVENTS.refundCompleted, { merchantRefundId: id, originalMerchantOrderId: o.merchantOrderId, refundId: r.refundId, amount: r.amount, state: r.state });
    }
    return Response.json({ refundId: r.refundId, amount: r.amount, state: 'PENDING' });
  }

  const refundStatus = /^payments\/v2\/refund\/([^/]+)\/status$/.exec(path);
  if (refundStatus && req.method === 'GET') {
    const r = state.refunds.get(decodeURIComponent(refundStatus[1]!));
    if (!r) return err(400, 'INVALID_MERCHANT_REFUND_ID', 'unknown merchantRefundId');
    return Response.json({ merchantRefundId: r.merchantRefundId, refundId: r.refundId, amount: r.amount, state: r.state });
  }

  return notFound();
}

export const GET = handle;
export const POST = handle;
