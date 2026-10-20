// The ErpAdapter for the operations app: mock, pg (stock in) and ops-api transports; orders out over signed HTTPS;
// leads to the existing intake endpoint.
import type { ErpAdapter, ErpLeadPayload, ErpOrderPayload, SettingsActionResult } from '@ecomkit/core/contracts';
import { env } from '@ecomkit/core/env';
import { NotConfiguredError, safeFetch } from '@ecomkit/core/http';
import { defineSettings, getSettings } from '@ecomkit/core/settings';
import { erpInventoryPageSchema, pushOrderResultSchema } from '@ecomkit/erp-sync/domain';
import { opsSettingsSchema, toIntakeBody, type OpsSettings } from '../domain';
import { pullPgPage } from './pg-transport';
import { mockSecret, signRequest } from './signing';

export const opsSettings = defineSettings('hasiru-ops-adapter', opsSettingsSchema);

export type Http = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<Response>;

export class OpsHttpError extends Error {
  override name = 'OpsHttpError';
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const MOCK_PATH = '/api/_mock/hasiru-ops';
export const mockBaseUrl = () => `${env.INTERNAL_BASE_URL.replace(/\/$/, '')}${MOCK_PATH}`;

export interface AdapterDeps {
  /** Mock mode: plain fetch to the in-app mock routes. Otherwise safeFetch (https, public hosts, allowlist). */
  http?: Http;
  now?: () => Date;
}

function defaultHttp(mock: boolean, allowHosts: string[]): Http {
  if (mock) return (url, init) => fetch(url, init);
  return (url, init) => safeFetch(url, init, { allowHosts, timeoutMs: 10_000, maxBytes: 20 * 1024 * 1024 });
}

const hostOf = (url: string) => (url ? new URL(url).hostname : '');

export function createOpsAdapter(s: OpsSettings, deps: AdapterDeps = {}): ErpAdapter {
  const mock = s.transport === 'mock';
  const now = deps.now ?? (() => new Date());
  const http = deps.http ?? defaultHttp(mock, [hostOf(s.opsBaseUrl), hostOf(s.leadsIntakeUrl)].filter(Boolean));
  const ops = mock ? { base: mockBaseUrl(), secret: mockSecret() as string | Buffer } : s.opsBaseUrl && s.opsHmacSecret ? { base: s.opsBaseUrl.replace(/\/$/, ''), secret: s.opsHmacSecret } : null;
  const intake = mock ? { url: `${mockBaseUrl()}/api/leads/intake`, secret: mockSecret().toString('hex') } : s.leadsIntakeUrl && s.leadsIntakeSecret ? { url: s.leadsIntakeUrl, secret: s.leadsIntakeSecret } : null;

  async function signed(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    if (!ops) throw new NotConfiguredError('hasiru-ops ops-api');
    const raw = body === undefined ? '' : JSON.stringify(body);
    const url = new URL(`${ops.base}${path}`);
    const headers = { ...signRequest({ method, path: `${url.pathname}${url.search}`, body: raw, secret: ops.secret, now: now() }), accept: 'application/json', ...(raw ? { 'content-type': 'application/json' } : {}) };
    const res = await http(url.toString(), { method, headers, ...(raw ? { body: raw } : {}) });
    if (!res.ok) throw new OpsHttpError(res.status, `ops-api ${method} ${url.pathname} returned ${res.status}`);
    return res.json();
  }

  const adapter: ErpAdapter = {
    id: `hasiru-ops:${s.transport}`,

    async pullInventory({ cursor }) {
      if (s.transport === 'pg') {
        if (!s.pgUrl) throw new NotConfiguredError('hasiru-ops pg');
        return pullPgPage(s.pgUrl, cursor, { now: now() });
      }
      const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      return erpInventoryPageSchema.parse(await signed('GET', `/api/ecom/inventory${qs}`));
    },

    async pushOrder(payload: ErpOrderPayload) {
      return pushOrderResultSchema.parse(await signed('POST', '/api/ecom/orders', payload));
    },

    async pushLead(lead: ErpLeadPayload) {
      if (!intake) throw new NotConfiguredError('hasiru-ops lead intake');
      const res = await http(intake.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-intake-secret': intake.secret },
        body: JSON.stringify(toIntakeBody(lead)),
      });
      // Create-only endpoint: 201 { ok: true }, no id comes back.
      if (res.status !== 201 && res.status !== 200) throw new OpsHttpError(res.status, `lead intake returned ${res.status}`);
      return { externalId: null };
    },

    async testConnection(): Promise<SettingsActionResult> {
      try {
        const page = await adapter.pullInventory({ since: null, cursor: null });
        const parts = [`Stock feed OK (${page.items.length}${page.nextCursor ? '+' : ''} items on the first page).`];
        parts.push(ops ? 'Orders endpoint configured.' : 'Orders endpoint not configured yet: orders wait in the outbox.');
        parts.push(intake ? 'Lead intake configured.' : 'Lead intake not configured.');
        return { ok: true, message: parts.join(' ') };
      } catch (err) {
        if (err instanceof NotConfiguredError) return { ok: false, message: 'Stock transport is not configured. Enter the connection details first.' };
        return { ok: false, message: `Connection failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300) };
      }
    },
  };
  return adapter;
}

/** What the host passes to erp-sync: `configureErpSync({ adapter: opsAdapter })`. Reads settings on every run. */
export async function opsAdapter(): Promise<ErpAdapter> {
  return createOpsAdapter(await getSettings(opsSettings));
}

export async function testConnectionAction(): Promise<SettingsActionResult> {
  return (await opsAdapter()).testConnection();
}
