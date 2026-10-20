// Shared test setup: env, queues, a staff viewer, and in-memory stand-ins for the ports flows reads through
// (cart, orders, leads, catalog, discounts are other modules; the host binds the real ones at boot).
import { randomBytes } from 'node:crypto';
import { ForbiddenError, setAuthProvider } from '@ecomkit/core/auth-context';
import { ROLE_PERMISSIONS, type Paise, type StaffViewer } from '@ecomkit/core/contracts';
import { resetEnv } from '@ecomkit/core/env';
import { ensureQueue, getBoss } from '@ecomkit/core/jobs';
import { configureFlows, type CartSnapshot, type Contact, type OrderSummary } from '../src/server/ports';

export function testEnv(): void {
  process.env.INTERNAL_SECRET = 'f'.repeat(40);
  process.env.SETTINGS_MASTER_KEY = `1:${randomBytes(32).toString('base64')}`;
  process.env.ENABLE_MOCKS = '1';
  process.env.SITE_URL = 'https://shop.example.test';
  resetEnv();
}

export async function createQueues(): Promise<void> {
  const boss = await getBoss();
  for (const q of ['notifications.deliver', 'core.event']) await ensureQueue(boss, q);
}

export const STAFF: StaffViewer = { kind: 'staff', userId: '0192a000-0000-7000-8000-0000000000aa', name: 'Owner', email: 'owner@example.test', role: 'owner', permissions: ROLE_PERMISSIONS.owner };

export function signIn(viewer: StaffViewer | null): void {
  setAuthProvider(async () => ({
    getViewer: async () => viewer ?? { kind: 'guest' },
    requirePermission: async (p) => {
      if (!viewer?.permissions.includes(p)) throw new ForbiddenError();
      return viewer;
    },
    requireOwner: async () => {
      throw new ForbiddenError();
    },
  }));
}

export interface Fakes {
  carts: Map<string, CartSnapshot>;
  orders: Map<string, OrderSummary>;
  /** Contacts (by phone) that placed an order, with the time. */
  purchases: { phone: string; at: Date }[];
  leads: Map<string, Contact & { link: string | null }>;
  restored: { cartId: string; couponCode: string | null }[];
  codes: { ruleId: string; phone: string; expiresAt: Date | null }[];
}

export function bindFakes(): Fakes {
  const f: Fakes = { carts: new Map(), orders: new Map(), purchases: [], leads: new Map(), restored: [], codes: [] };
  configureFlows({
    carts: {
      snapshot: async (cartId) => f.carts.get(cartId) ?? null,
      restore: async (cartId, { couponCode }) => {
        f.restored.push({ cartId, couponCode });
        return true;
      },
    },
    orders: {
      summary: async (orderId) => f.orders.get(orderId) ?? null,
      hasOrderSince: async (c, since) => f.purchases.some((p) => p.phone === c.phone && p.at >= since),
    },
    leads: { get: async (id) => f.leads.get(id) ?? null },
    products: { label: async (id) => ({ name: `Product ${id.slice(0, 4)}`, href: `/p/${id}` }) },
    discounts: {
      createSingleUseCode: async (o) => {
        f.codes.push(o);
        return `CODE${f.codes.length}`;
      },
    },
  });
  return f;
}

export const cart = (contact: Contact | null, status: CartSnapshot['status'] = 'abandoned'): CartSnapshot => ({ status, contact, totalPaise: 450_000 as Paise, itemCount: 12 });

export const order = (contact: Contact, over: Partial<OrderSummary> = {}): OrderSummary => ({
  number: 'A-2610-00001',
  status: 'paid',
  isTest: false,
  contact,
  totalPaise: 1_250_00 as Paise,
  deliveryDate: 'Sat 24 Oct',
  slotWindow: '9 am to 1 pm',
  link: 'https://shop.example.test/order/tok',
  ...over,
});
