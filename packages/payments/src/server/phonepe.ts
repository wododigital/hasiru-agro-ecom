// Typed fetch client for the gateway's five calls (token, pay, status, refund, refund status) and the adapter
// over it. No vendor SDK: its singleton fights per-request settings and the mock swap.
import { createHash } from 'node:crypto';
import type {
  CreatePaymentInput,
  CreatePaymentResult,
  Paise,
  PaymentProvider,
  PaymentStatus,
  PaymentWebhookInput,
  PaymentWebhookResult,
  RefundInput,
  RefundResult,
  SettingsActionResult,
} from '@ecomkit/core/contracts';
import { NotConfiguredError, safeFetch, timingSafeEqual } from '@ecomkit/core/http';
import {
  errorResponse,
  gatewayState,
  payRequest,
  payResponse,
  PHONEPE_ALLOW_HOSTS,
  PHONEPE_HOSTS,
  PHONEPE_PATHS,
  refundResponse,
  refundStatusResponse,
  statusResponse,
  tokenResponse,
  webhookBody,
  webhookDedupeKey,
} from '../domain';
import type { PaymentsSettings } from '../settings';
import { mockBase, webhookCredentials } from './config';

export type Gateway = PaymentsSettings['mode'];

export class GatewayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

export interface ClientOptions {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface CachedToken {
  token: string;
  refreshAtMs: number;
}
const g = globalThis as unknown as { __ecomkitPayTokens?: Map<string, CachedToken>; __ecomkitPayInflight?: Map<string, Promise<CachedToken>> };
const tokens = (g.__ecomkitPayTokens ??= new Map());
const inflight = (g.__ecomkitPayInflight ??= new Map());

export function clearTokenCache(): void {
  tokens.clear();
  inflight.clear();
}

function endpoints(gateway: Gateway): { token: string; api: string } {
  if (gateway === 'mock') return { token: `${mockBase()}/v1/oauth/token`, api: mockBase() };
  return PHONEPE_HOSTS[gateway];
}

type Http = (url: string, init: { method: string; headers: Record<string, string>; body?: string | URLSearchParams }) => Promise<Response>;
function http(gateway: Gateway): Http {
  // The mock is the app itself on INTERNAL_BASE_URL (plain http on localhost), so it skips the SSRF guard.
  if (gateway === 'mock') return (url, init) => fetch(url, init);
  return (url, init) => safeFetch(url, init, { allowHosts: PHONEPE_ALLOW_HOSTS, timeoutMs: 15_000 });
}

function credentials(s: PaymentsSettings, gateway: Gateway): { id: string; secret: string; version: string } {
  if (gateway === 'mock') return { id: s.clientId || 'mock-client', secret: s.clientSecret || 'mock-secret', version: s.clientVersion };
  if (!s.clientId || !s.clientSecret) throw new NotConfiguredError('phonepe');
  return { id: s.clientId, secret: s.clientSecret, version: s.clientVersion };
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { message: text.slice(0, 200) };
  }
}

/** Retries after a 429 inside one call; past these the caller (poll job) backs off. */
const RETRIES_429 = 2;

export function phonepeClient(s: PaymentsSettings, gateway: Gateway, options: ClientOptions = {}) {
  const sleep = options.sleep ?? realSleep;
  const now = options.now ?? Date.now;
  const urls = endpoints(gateway);
  const send = http(gateway);
  const creds = () => credentials(s, gateway);
  const cacheKey = () => `${gateway}:${creds().id}:${creds().version}`;

  async function fetchToken(): Promise<CachedToken> {
    const c = creds();
    const res = await send(urls.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ client_id: c.id, client_version: c.version, client_secret: c.secret, grant_type: 'client_credentials' }),
    });
    const json = await readJson(res);
    if (!res.ok) {
      const e = errorResponse.safeParse(json);
      throw new GatewayError(res.status, e.data?.code ?? null, `token request failed (${res.status})`);
    }
    const t = tokenResponse.parse(json);
    const fetchedAt = now();
    const expiresAtMs = t.expires_at * 1000;
    // Refresh ahead of expiry: 120 s, or half the lifetime for short-lived tokens.
    return { token: t.access_token, refreshAtMs: expiresAtMs - Math.min(120_000, Math.max(0, (expiresAtMs - fetchedAt) / 2)) };
  }

  /** Cached by expires_at; one in-flight request per credential set so concurrent checkouts do not stampede. */
  async function token(force = false): Promise<string> {
    const key = cacheKey();
    const cached = tokens.get(key);
    if (!force && cached && now() < cached.refreshAtMs) return cached.token;
    let p = inflight.get(key);
    if (!p) {
      p = fetchToken().finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    const fresh = await p;
    tokens.set(key, fresh);
    return fresh.token;
  }

  async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    let reauthed = false;
    for (let hits = 0; ; ) {
      const res = await send(urls.api + path, {
        method,
        headers: { authorization: `O-Bearer ${await token()}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (res.status === 401 && !reauthed) {
        reauthed = true;
        await res.body?.cancel();
        await token(true);
        continue;
      }
      if (res.status === 429 && hits < RETRIES_429) {
        await res.body?.cancel();
        await sleep(500 * 2 ** hits++);
        continue;
      }
      const json = await readJson(res);
      if (!res.ok) {
        const e = errorResponse.safeParse(json);
        throw new GatewayError(res.status, e.data?.code ?? null, `${method} ${path.split('?')[0]} failed (${res.status}${e.data?.code ? ` ${e.data.code}` : ''})`);
      }
      return json;
    }
  }

  return {
    token,
    pay: async (req: ReturnType<typeof payRequest>) => payResponse.parse(await call('POST', PHONEPE_PATHS.pay, req)),
    status: async (merchantOrderId: string) => statusResponse.parse(await call('GET', PHONEPE_PATHS.status(merchantOrderId))),
    refund: async (req: { merchantRefundId: string; originalMerchantOrderId: string; amount: number }) => refundResponse.parse(await call('POST', PHONEPE_PATHS.refund, req)),
    refundStatus: async (merchantRefundId: string) => refundStatusResponse.parse(await call('GET', PHONEPE_PATHS.refundStatus(merchantRefundId))),
  };
}

/**
 * Webhook auth: the gateway sends `Authorization: SHA256(username:password)`. The encoding is not documented,
 * so lowercase hex and base64 are both accepted (with or without a `SHA256 ` prefix) until a sandbox callback
 * confirms one. Constant-time compares; any length mismatch fails.
 */
export function webhookAuthorized(header: string | null | undefined, creds: { username: string; password: string } | null): boolean {
  if (!header || !creds) return false;
  const given = header.trim().replace(/^sha256[\s=:]+/i, '');
  const digest = createHash('sha256').update(`${creds.username}:${creds.password}`).digest();
  return timingSafeEqual(given.toLowerCase(), digest.toString('hex')) || timingSafeEqual(given, digest.toString('base64'));
}

export type RefundStatusResult = RefundResult & { raw: unknown };
export type GatewayProvider = PaymentProvider & { refundStatus(merchantRefundId: string): Promise<RefundStatusResult> };

const refundState = (s: string): RefundResult['state'] => (gatewayState(s) === 'pending' ? 'pending' : gatewayState(s) === 'completed' ? 'completed' : 'failed');

/** The gateway adapter. `mock` is the same client pointed at the in-app mock, so the real HTTP path runs in dev and tests. */
export function phonepeProvider(s: PaymentsSettings, gateway: Gateway, options: ClientOptions = {}): GatewayProvider {
  const client = phonepeClient(s, gateway, options);
  return {
    id: gateway === 'mock' ? 'mock' : 'phonepe',
    kind: 'redirect',

    async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
      const res = await client.pay(
        payRequest({
          merchantOrderId: input.attemptId,
          amountPaise: input.amountPaise,
          expireAfterSec: (input.expiresAt.getTime() - Date.now()) / 1000,
          redirectUrl: input.returnUrl,
          orderRef: input.orderId,
          message: input.orderNumber,
        }),
      );
      return { providerRef: res.orderId, redirectUrl: res.redirectUrl, state: gatewayState(res.state), expiresAt: res.expireAt ? new Date(res.expireAt) : input.expiresAt };
    },

    async fetchStatus(merchantOrderId: string): Promise<PaymentStatus> {
      const res = await client.status(merchantOrderId);
      const state = gatewayState(res.state);
      const paid = res.paymentDetails?.find((d) => gatewayState(d.state) === 'completed');
      return {
        providerRef: merchantOrderId,
        state,
        amountPaise: (res.amount ?? 0) as Paise,
        paidAt: state === 'completed' ? new Date(paid?.timestamp ?? Date.now()) : null,
        raw: res,
      };
    },

    async handleWebhook({ rawBody, headers }: PaymentWebhookInput): Promise<PaymentWebhookResult> {
      const none: PaymentWebhookResult = { verified: false, eventId: null, providerRef: null, event: null, state: null };
      if (!webhookAuthorized(headers.authorization, webhookCredentials(s))) return none;
      let body;
      try {
        body = webhookBody.parse(JSON.parse(rawBody));
      } catch {
        return none;
      }
      const event = body.event ?? body.type ?? 'unknown';
      const ref = body.payload.merchantRefundId ?? body.payload.merchantOrderId ?? body.payload.originalMerchantOrderId ?? null;
      const rawState = body.payload.state ?? '';
      return { verified: true, eventId: ref ? webhookDedupeKey(event, ref, rawState) : null, providerRef: ref, event, state: ref ? gatewayState(rawState) : null };
    },

    async refund(input: RefundInput): Promise<RefundResult> {
      const res = await client.refund({ merchantRefundId: input.refundId, originalMerchantOrderId: input.providerRef, amount: input.amountPaise });
      return { providerRefundRef: res.refundId, state: refundState(res.state) };
    },

    async refundStatus(merchantRefundId: string): Promise<RefundStatusResult> {
      const res = await client.refundStatus(merchantRefundId);
      return { providerRefundRef: res.refundId ?? merchantRefundId, state: refundState(res.state), raw: res };
    },

    async testConnection(): Promise<SettingsActionResult> {
      try {
        await client.token(true);
        return { ok: true, message: `Connected to the ${gateway} gateway (token issued).` };
      } catch (err) {
        if (err instanceof NotConfiguredError) return { ok: false, message: 'Enter the client ID and client secret first.' };
        return { ok: false, message: `Could not get a token: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  };
}
