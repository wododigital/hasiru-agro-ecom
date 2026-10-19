// Mock Meta Graph API (WhatsApp Cloud + Marketing Messages + templates) for dev and test.
// Route: /api/_mock/meta/[...path]. 404 unless ENABLE_MOCKS=1. State lives in this process only.
import { env } from '@ecomkit/core/env';
import { signHmacSha256 } from '@ecomkit/core/http';
import { newId } from '@ecomkit/core/ids';
import { whatsappConfig } from '../server/channels';
import { loadSettings } from '../server/config';

interface MockTemplate {
  id: string;
  name: string;
  status: string;
  category: string;
  language: string;
  components: unknown[];
}
export interface MetaMockSent {
  wamid: string;
  endpoint: 'messages' | 'marketing_messages';
  body: Record<string, unknown>;
  at: string;
}
interface MetaMockState {
  sent: MetaMockSent[];
  templates: Map<string, MockTemplate>;
  /** Next send fails with this error code: 130429 synchronously, others (131049, 131026) by status webhook. */
  failNext: number | null;
  statusDelayMs: number;
  approveAfterMs: number;
  pending: Set<Promise<unknown>>;
}

const g = globalThis as unknown as { __ecomkitMetaMock?: MetaMockState };
export const metaMockState = (): MetaMockState =>
  (g.__ecomkitMetaMock ??= { sent: [], templates: new Map(), failNext: null, statusDelayMs: 300, approveAfterMs: 2000, pending: new Set() });

/** Waits for every webhook the mock has scheduled (tests). */
export async function flushMetaMock(): Promise<void> {
  while (metaMockState().pending.size) await Promise.all([...metaMockState().pending]);
}

export function resetMetaMock(): void {
  delete g.__ecomkitMetaMock;
}

const enabled = () => process.env.ENABLE_MOCKS === '1';
const notFound = () => new Response(null, { status: 404 });

/** Posts a signed webhook to our own endpoint, like Meta does. */
async function fireWebhook(field: string, value: Record<string, unknown>): Promise<void> {
  const cfg = whatsappConfig(await loadSettings());
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: cfg?.wabaId ?? 'mock-waba', changes: [{ field, value }] }] });
  await fetch(`${env.INTERNAL_BASE_URL.replace(/\/$/, '')}/api/webhooks/whatsapp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${signHmacSha256(body, cfg?.appSecret ?? '')}` },
    body,
  }).catch(() => undefined);
}

function later(ms: number, fn: () => Promise<void>): void {
  const state = metaMockState();
  const p: Promise<void> = new Promise<void>((r) => setTimeout(r, ms)).then(fn).finally(() => state.pending.delete(p));
  state.pending.add(p);
}

const pricing = (category: string) => ({ billable: true, pricing_model: 'PMP', type: 'regular', category });

async function handle(req: Request): Promise<Response> {
  if (!enabled()) return notFound();
  const url = new URL(req.url);
  const parts = url.pathname.split('/api/_mock/meta/')[1]?.split('/').filter(Boolean) ?? [];
  const state = metaMockState();
  const json = req.method === 'POST' ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : {};

  // Controls for tests and the dev outbox page.
  if (parts[0] === '_control' && req.method === 'POST') {
    if ('failNext' in json) state.failNext = json.failNext === null ? null : Number(json.failNext);
    if (typeof json.statusDelayMs === 'number') state.statusDelayMs = json.statusDelayMs;
    if (typeof json.approveAfterMs === 'number') state.approveAfterMs = json.approveAfterMs;
    return Response.json({ ok: true });
  }
  if (parts[0] === '_state') return Response.json({ sent: state.sent, templates: [...state.templates.values()] });
  if (parts[0] === '_inbound' && req.method === 'POST') {
    const from = String(json.from ?? '').replace(/\D/g, '');
    const id = `wamid.mock.in.${newId()}`;
    const value = { messaging_product: 'whatsapp', contacts: [{ wa_id: from, profile: { name: 'Mock customer' } }], messages: [{ id, from, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: String(json.text ?? '') } }] };
    await fireWebhook('messages', value);
    return Response.json({ id });
  }

  const [, node, edge] = parts; // parts[0] is the Graph version
  if (!node) return notFound();
  if (req.headers.get('authorization') !== `Bearer ${whatsappConfig(await loadSettings())?.token ?? ''}`) {
    return Response.json({ error: { code: 190, message: 'Invalid OAuth access token' } }, { status: 401 });
  }

  if (!edge && req.method === 'GET') return Response.json({ id: node, display_phone_number: '+91 00000 00000', verified_name: 'Mock business' });

  if ((edge === 'messages' || edge === 'marketing_messages') && req.method === 'POST') {
    const fail = state.failNext;
    state.failNext = null;
    if (fail === 130429) return Response.json({ error: { code: 130429, message: 'Rate limit hit' } }, { status: 400 });
    const template = json.template as { name?: string } | undefined;
    const known = template?.name ? state.templates.get(template.name) : undefined;
    if (edge === 'marketing_messages' && known && known.category !== 'MARKETING') {
      return Response.json({ error: { code: 131009, message: 'Only marketing templates can be sent with this API' } }, { status: 400 });
    }
    const wamid = `wamid.mock.${newId()}`;
    state.sent.push({ wamid, endpoint: edge, body: json, at: new Date().toISOString() });
    const to = String(json.to ?? '').replace(/\D/g, '');
    const category = edge === 'marketing_messages' ? 'marketing_lite' : 'utility';
    const status = (s: string, extra: Record<string, unknown> = {}) => () =>
      fireWebhook('messages', { messaging_product: 'whatsapp', statuses: [{ id: wamid, status: s, timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: to, ...extra }] });
    if (fail !== null) {
      later(state.statusDelayMs, status('failed', { errors: [{ code: fail, title: fail === 131049 ? 'This message was not delivered to maintain healthy ecosystem engagement.' : 'Message undeliverable' }] }));
    } else {
      later(state.statusDelayMs, async () => {
        await status('sent', { pricing: pricing(category) })();
        await status('delivered', { pricing: pricing(category) })();
        await status('read')();
      });
    }
    return Response.json({ messaging_product: 'whatsapp', contacts: [{ input: json.to, wa_id: to }], messages: [{ id: wamid }] });
  }

  if (edge === 'message_templates') {
    if (req.method === 'GET') return Response.json({ data: [...state.templates.values()], paging: { cursors: {} } });
    const name = String(json.name ?? '');
    if (!/^[a-z0-9_]{1,512}$/.test(name)) return Response.json({ error: { code: 100, message: 'Invalid template name' } }, { status: 400 });
    const t: MockTemplate = { id: `tpl_${newId()}`, name, status: 'PENDING', category: String(json.category ?? 'UTILITY'), language: String(json.language ?? 'en'), components: (json.components as unknown[]) ?? [] };
    state.templates.set(name, t);
    later(state.approveAfterMs, async () => {
      t.status = 'APPROVED';
      await fireWebhook('message_template_status_update', { event: 'APPROVED', message_template_id: t.id, message_template_name: t.name, message_template_language: t.language, reason: null });
    });
    return Response.json({ id: t.id, status: 'PENDING', category: t.category });
  }
  return notFound();
}

export const GET = handle;
export const POST = handle;
