import { randomBytes } from 'node:crypto';
import { withTx } from '@ecomkit/core/db';
import { newId } from '@ecomkit/core/ids';
import { createTestDb, queuedJobs, type TestDb } from '@ecomkit/core/testing';
import type { CreateOrderInput } from '../src/domain';
import { createOrder } from '../src/server';

/** Own database per test file (vitest runs files in parallel): ecomkit_wp_19_orders_<suffix>. */
export async function ordersDb(suffix: string): Promise<TestDb> {
  process.env.INTERNAL_SECRET ??= 'i'.repeat(40);
  process.env.SETTINGS_MASTER_KEY ??= `1:${randomBytes(32).toString('base64')}`;
  return createTestDb(`wp-19-orders-${suffix}`, { schemas: ['core', 'customers', 'orders'] });
}

/** Two lines: 10 saplings at 0% (HSN 0602) and one bag of compost at 5% (HSN 3101), local delivery in KA. */
export function orderInput(overrides: Partial<CreateOrderInput> = {}): CreateOrderInput {
  const plant = { variantId: newId(), productId: newId() };
  const compost = { variantId: newId(), productId: newId() };
  return {
    customerId: null,
    contact: { name: 'Asha', phone: '+919876543210', email: 'asha@example.test' },
    shippingAddress: { name: 'Asha', phone: '+919876543210', line1: '12 Farm Road', pincode: '560001', district: 'Sample District', state: 'Karnataka', stateCode: 'KA' },
    delivery: { methodId: 'local', kind: 'local_slot', label: 'Local delivery', slotDate: '2026-10-24', vehicle: 'Small pickup' },
    lines: [
      {
        ...plant,
        snapshot: { name: 'Sapling A', sku: 'SKU-A', hsn: '0602', gstRatePct: 0, sizeClass: 'M', weightKg: 2 },
        qty: 10,
        listUnitPaise: 20_000,
        unitPaise: 20_000,
        lineTotalPaise: 200_000,
      },
      {
        ...compost,
        snapshot: { name: 'Compost 25 kg', sku: 'SKU-C', hsn: '3101', gstRatePct: 5, sizeClass: null, weightKg: 25 },
        qty: 1,
        listUnitPaise: 52_500,
        unitPaise: 52_500,
        taxPaise: 2_500,
        lineTotalPaise: 52_500,
      },
    ],
    totals: {
      subtotalPaise: 252_500,
      tierSavingsPaise: 0,
      promoPaise: 0,
      couponPaise: 0,
      packingPaise: 0,
      shippingPaise: 11_800,
      taxPaise: 4_300,
      totalPaise: 264_300,
      weightKg: 45,
      chargesGstRatePct: 18,
      breakdown: {},
    },
    ...overrides,
  };
}

export async function placeTestOrder(overrides: Partial<CreateOrderInput> = {}) {
  return withTx((tx) => createOrder(orderInput(overrides), { tx }));
}

export async function outboxEvents(t: TestDb, event?: string): Promise<{ event: string; payload: Record<string, unknown> }[]> {
  const jobs = await queuedJobs(t.db, 'core.event');
  return jobs.map((j) => j.data as { event: string; payload: Record<string, unknown> }).filter((e) => !event || e.event === event);
}
