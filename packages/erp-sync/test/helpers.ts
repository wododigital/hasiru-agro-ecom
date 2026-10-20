import { randomBytes } from 'node:crypto';
import type { ErpAdapter, ErpInventoryItem, ErpOrderPayload, Paise } from '@ecomkit/core/contracts';
import { NotConfiguredError } from '@ecomkit/core/http';
import { createTestDb, queuedJobs, type TestDb } from '@ecomkit/core/testing';

/** Own database per test file (vitest runs files in parallel): ecomkit_wp_27_<suffix>. */
export async function erpDb(suffix: string): Promise<TestDb> {
  process.env.INTERNAL_SECRET ??= 'e'.repeat(40);
  process.env.SETTINGS_MASTER_KEY ??= `1:${randomBytes(32).toString('base64')}`;
  return createTestDb(`wp-27-${suffix}`, { schemas: ['core', 'inventory', 'erp-sync'] });
}

export interface FakeAdapter extends ErpAdapter {
  items: ErpInventoryItem[];
  pageSize: number;
  pulls: (string | null)[];
  orders: ErpOrderPayload[];
  leads: string[];
  failPulls: boolean;
  failPushes: number;
  ordersNotConfigured: boolean;
  /** Slow pushes: lets two concurrent runs overlap. */
  delayMs: number;
}

/** In-memory ERP: keyset pages by erpItemId, records every push, idempotent on ecomOrderNumber like the real contract. */
export function fakeAdapter(items: ErpInventoryItem[] = [], pageSize = 1000): FakeAdapter {
  const known = new Map<string, string>();
  const a: FakeAdapter = {
    id: 'fake',
    items,
    pageSize,
    pulls: [],
    orders: [],
    leads: [],
    failPulls: false,
    failPushes: 0,
    ordersNotConfigured: false,
    delayMs: 0,
    async pullInventory({ cursor }) {
      a.pulls.push(cursor);
      if (a.failPulls) throw new Error('ERP down');
      const sorted = [...a.items].sort((x, y) => x.erpItemId.localeCompare(y.erpItemId));
      const start = cursor ? sorted.findIndex((i) => i.erpItemId > cursor) : 0;
      const page = start < 0 ? [] : sorted.slice(start, start + a.pageSize);
      return { items: page, nextCursor: page.length === a.pageSize && start + a.pageSize < sorted.length ? page[page.length - 1]!.erpItemId : null };
    },
    async pushOrder(payload) {
      if (a.ordersNotConfigured) throw new NotConfiguredError('fake orders');
      if (a.delayMs) await new Promise((r) => setTimeout(r, a.delayMs));
      if (a.failPushes > 0) {
        a.failPushes--;
        throw Object.assign(new Error('ERP returned 503'), { status: 503 });
      }
      a.orders.push(payload);
      if (!known.has(payload.ecomOrderNumber)) known.set(payload.ecomOrderNumber, `OPS-${known.size + 1}`);
      return { opsOrderId: known.get(payload.ecomOrderNumber)!, invoiceNumber: null };
    },
    async pushLead(lead) {
      a.leads.push(lead.leadId);
      return { externalId: null };
    },
    async testConnection() {
      return { ok: true, message: 'ok' };
    },
  };
  return a;
}

export function item(n: number, extra: Partial<ErpInventoryItem> = {}): ErpInventoryItem {
  return {
    erpItemId: `item-${String(n).padStart(5, '0')}`,
    sku: null,
    name: `Plant ${n}`,
    variety: null,
    available: n % 50,
    readyInDays: null,
    costPaise: null,
    updatedAt: '2026-10-20T04:30:00.000Z',
    ...extra,
  };
}

export function orderPayload(orderNumber: string): ErpOrderPayload {
  return {
    ecomOrderNumber: orderNumber,
    placedAt: '2026-10-20T05:00:00.000Z',
    customer: { name: 'Test Buyer', phone: '+919800000001', email: null, gstin: null },
    deliver: { method: 'pickup', slotDate: null, district: 'Sample District', address: 'Store pickup' },
    lines: [{ erpItemId: 'item-00001', sku: 'SKU-1', name: 'Plant 1', qty: 2, unitPaise: 15000 as Paise, lineTotalPaise: 30000 as Paise }],
    totals: { subtotalPaise: 30000 as Paise, discountPaise: 0 as Paise, shippingPaise: 0 as Paise, taxPaise: 0 as Paise, totalPaise: 30000 as Paise, paidPaise: 30000 as Paise },
    status: 'paid',
  };
}

/** Catalogue events written as core.event jobs, optionally for one event name. */
export async function events(t: TestDb, name?: string): Promise<{ event: string; payload: Record<string, unknown> }[]> {
  return (await queuedJobs(t.db, 'core.event'))
    .map((j) => j.data as { event: string; payload: Record<string, unknown> })
    .filter((e) => !name || e.event === name);
}
