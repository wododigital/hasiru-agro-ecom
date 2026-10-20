// Mock operations app for dev and test. Route: /api/_mock/hasiru-ops/[...path]. 404 unless ENABLE_MOCKS=1.
//   GET  api/ecom/inventory?cursor=&limit=   signed; 200 items, keyset pages (default 80 per page)
//   POST api/ecom/orders                     signed; idempotent on ecomOrderNumber
//   POST api/leads/intake                    x-intake-secret; create-only, 201 { ok: true }
//   POST _control { drift?, failOrders?, items? }   GET _state
// State lives in this process only.
import { timingSafeEqual } from '@ecomkit/core/http';
import { erpOrderPayloadSchema } from '@ecomkit/erp-sync/domain';
import { mockSecret, verifyRequest } from '../server/signing';

interface MockItem {
  id: string;
  name: string;
  variety: string | null;
  available: number;
  readyInDays: number | null;
  costPaise: number;
}
interface OpsMockState {
  items: MockItem[];
  /** Shifts every 7th item's stock by +3 (drift against what the store last pulled). */
  drift: boolean;
  /** Fail the next N order pushes with a 503. */
  failOrders: number;
  orders: Map<string, { opsOrderId: string; body: unknown; pushes: number }>;
  leads: Record<string, unknown>[];
  nonces: Set<string>;
}

const PLANTS = ['Mango', 'Jackfruit', 'Sapota', 'Guava', 'Coconut', 'Teak', 'Mahogany', 'Jamun', 'Amla', 'Tamarind'];
const VARIETIES = ['Alphonso', 'Banganapalli', 'Mallika', 'Totapuri', 'Raspuri', null, 'Dwarf', 'Grafted', 'Seedling', 'Local'];

/** 200 deterministic items with ids that sort in insertion order. */
function seedItems(n = 200): MockItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    name: PLANTS[i % PLANTS.length]!,
    variety: VARIETIES[Math.floor(i / PLANTS.length) % VARIETIES.length] ?? null,
    available: (i * 37) % 120,
    readyInDays: (i * 37) % 120 === 0 ? 30 + (i % 60) : null,
    costPaise: 4000 + (i % 25) * 500,
  }));
}

const g = globalThis as unknown as { __ecomkitOpsMock?: OpsMockState };
export const opsMockState = (): OpsMockState =>
  (g.__ecomkitOpsMock ??= { items: seedItems(), drift: false, failOrders: 0, orders: new Map(), leads: [], nonces: new Set() });
export const resetOpsMock = () => void delete g.__ecomkitOpsMock;

const enabled = () => process.env.ENABLE_MOCKS === '1';
const json = (body: unknown, status = 200) => Response.json(body, { status });

async function handle(req: Request): Promise<Response> {
  if (!enabled()) return new Response(null, { status: 404 });
  const url = new URL(req.url);
  const path = url.pathname.split('/api/_mock/hasiru-ops/')[1] ?? '';
  const state = opsMockState();
  const body = req.method === 'GET' ? '' : await req.text();

  if (path === '_control' && req.method === 'POST') {
    const c = JSON.parse(body || '{}') as { drift?: boolean; failOrders?: number; items?: number };
    if (typeof c.drift === 'boolean') state.drift = c.drift;
    if (typeof c.failOrders === 'number') state.failOrders = c.failOrders;
    if (typeof c.items === 'number') state.items = seedItems(c.items);
    return json({ ok: true });
  }
  if (path === '_state') return json({ orders: [...state.orders.entries()].map(([k, v]) => ({ ecomOrderNumber: k, ...v })), leads: state.leads, drift: state.drift });

  if (path === 'api/leads/intake' && req.method === 'POST') {
    if (!timingSafeEqual(req.headers.get('x-intake-secret') ?? '', mockSecret().toString('hex'))) return json({ error: 'unauthorized' }, 401);
    const lead = JSON.parse(body || '{}') as Record<string, unknown>;
    if (!lead.name && !lead.phone) return json({ error: 'name or phone required' }, 422);
    state.leads.push(lead);
    return json({ ok: true }, 201);
  }

  // Signed ops-api endpoints.
  const verified = verifyRequest({ method: req.method, path: `${url.pathname}${url.search}`, body, headers: req.headers, secret: mockSecret() });
  if (!verified.ok) return json({ error: 'unauthorized' }, 401);
  if (state.nonces.has(verified.nonce)) return json({ error: 'replayed' }, 401);
  state.nonces.add(verified.nonce);

  if (path === 'api/ecom/inventory' && req.method === 'GET') {
    const cursor = url.searchParams.get('cursor');
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 80, 1), 1000);
    const start = cursor ? state.items.findIndex((i) => i.id > cursor) : 0;
    const page = start < 0 ? [] : state.items.slice(start, start + limit);
    const at = new Date().toISOString();
    return json({
      items: page.map((it, idx) => ({
        erpItemId: it.id,
        sku: null,
        name: it.name,
        variety: it.variety,
        available: state.drift && (start + idx) % 7 === 0 ? it.available + 3 : it.available,
        readyInDays: it.readyInDays,
        costPaise: it.costPaise,
        updatedAt: at,
      })),
      nextCursor: start >= 0 && start + limit < state.items.length ? page[page.length - 1]!.id : null,
    });
  }

  if (path === 'api/ecom/orders' && req.method === 'POST') {
    if (state.failOrders > 0) {
      state.failOrders--;
      return json({ error: 'unavailable' }, 503);
    }
    const parsed = erpOrderPayloadSchema.safeParse(JSON.parse(body || '{}'));
    if (!parsed.success) return json({ error: 'invalid order' }, 422);
    const existing = state.orders.get(parsed.data.ecomOrderNumber);
    if (existing) {
      existing.pushes++;
      return json({ opsOrderId: existing.opsOrderId, invoiceNumber: null });
    }
    const opsOrderId = `OPS-${String(state.orders.size + 1).padStart(5, '0')}`;
    state.orders.set(parsed.data.ecomOrderNumber, { opsOrderId, body: parsed.data, pushes: 1 });
    return json({ opsOrderId, invoiceNumber: null }, 201);
  }
  return json({ error: 'not found' }, 404);
}

export const GET = handle;
export const POST = handle;
