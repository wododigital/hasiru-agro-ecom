import { emit } from '@ecomkit/core/events';
import { newId } from '@ecomkit/core/ids';
import { startWorker } from '@ecomkit/core/jobs';
import coreManifest, { createRegistry, defineModule } from '@ecomkit/core/manifest';
import type { TestDb } from '@ecomkit/core/testing';
import inventoryManifest from '@ecomkit/inventory/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import erpManifest from '../src/manifest';
import { erpOutbox } from '../src/schema';
import { acceptStatusCallback, configureErpSync } from '../src/server';
import { erpDb } from './helpers';

// The real worker with this module's manifest: event subscribers write outbox rows, schedules are registered.
// Catalog is inventory's hard dependency and has nothing this test needs, so a bare manifest stands in for it.
const catalogStandIn = defineModule({ id: 'catalog', dependsOn: ['core'] });
const registry = createRegistry([coreManifest, catalogStandIn, inventoryManifest, erpManifest], { mocks: true });

let t: TestDb;
let worker: { stop(): Promise<void> } | undefined;

async function waitFor(check: () => Promise<boolean>, ms = 20_000): Promise<void> {
  const until = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > until) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 150));
  }
}

beforeAll(async () => {
  t = await erpDb('worker');
  worker = await startWorker(registry, { name: 'erp-sync-test', pollingIntervalSeconds: 0.5 });
});
afterAll(async () => {
  await worker?.stop();
  await t?.close();
});

describe('manifest', () => {
  it('subscribes to order.paid, order.confirmed and lead.created only (enquiries never push directly)', () => {
    expect(Object.keys(erpManifest.on).sort()).toEqual(['lead.created', 'order.confirmed', 'order.paid']);
    expect(registry.subscribers('enquiry.created').some((s) => s.moduleId === 'erp-sync')).toBe(false);
  });

  it('declares only modules from this or an earlier wave as hard dependencies', () => {
    expect(erpManifest.dependsOn).toEqual(['core', 'inventory']);
    expect(registry.list('healthChecks').map((h) => h.id)).toEqual(expect.arrayContaining(['erp-sync.pull-age', 'erp-sync.dead-letter']));
  });

  it('registers both schedules every minute in IST', async () => {
    const { rows } = await t.pool.query<{ name: string; cron: string; timezone: string }>("select name, cron, timezone from pgboss.schedule where name like 'erp-sync.%' order by name");
    expect(rows).toEqual([
      { name: 'erp-sync.pull-inventory', cron: '* * * * *', timezone: 'Asia/Kolkata' },
      { name: 'erp-sync.push-outbox', cron: '* * * * *', timezone: 'Asia/Kolkata' },
    ]);
  });
});

describe('events through the worker', () => {
  it('lead.created and order.paid become outbox rows; enquiry.created does not', async () => {
    const leadId = newId();
    const orderId = newId();
    const enquiryLead = newId();
    await emit('enquiry.created', { enquiryId: newId(), leadId: enquiryLead });
    await emit('lead.created', { leadId, source: 'enquiry' });
    await emit('order.paid', { orderId, orderNumber: 'T-9001', amountPaise: 100 as never, paymentAttemptId: null });
    await waitFor(async () => (await t.db.select().from(erpOutbox)).length >= 2);
    await new Promise((r) => setTimeout(r, 1000));
    const rows = await t.db.select({ kind: erpOutbox.kind, refId: erpOutbox.refId }).from(erpOutbox);
    expect(rows.sort((a, b) => a.kind.localeCompare(b.kind))).toEqual([
      { kind: 'lead', refId: leadId },
      { kind: 'order', refId: orderId },
    ]);
  });
});

describe('status callbacks', () => {
  it('applies once per nonce and reports unknown orders', async () => {
    const applied: string[] = [];
    configureErpSync({ applyOrderStatus: async (s) => (s.ecomOrderNumber === 'T-1' ? (applied.push(s.status), true) : false) });
    expect(await acceptStatusCallback('nonce-aaaaaaaaaaaaaaaa', { ecomOrderNumber: 'T-1', status: 'dispatched' })).toEqual({ ok: true, outcome: 'applied' });
    expect(await acceptStatusCallback('nonce-aaaaaaaaaaaaaaaa', { ecomOrderNumber: 'T-1', status: 'dispatched' })).toEqual({ ok: true, outcome: 'duplicate' });
    expect(await acceptStatusCallback('nonce-bbbbbbbbbbbbbbbb', { ecomOrderNumber: 'T-2', status: 'packed' })).toEqual({ ok: true, outcome: 'unknown_order' });
    expect(await acceptStatusCallback('nonce-cccccccccccccccc', { ecomOrderNumber: 'T-1', status: 'cancelled' })).toEqual({ ok: false, error: 'invalid_body' });
    configureErpSync({ applyOrderStatus: null });
    expect(await acceptStatusCallback('nonce-dddddddddddddddd', { ecomOrderNumber: 'T-1', status: 'delivered' })).toEqual({ ok: true, outcome: 'no_handler' });
    expect(applied).toEqual(['dispatched']);
  });
});
