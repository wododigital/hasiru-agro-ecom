import { newId } from '@ecomkit/core/ids';
import type { TestDb } from '@ecomkit/core/testing';
import { seedLevels } from '@ecomkit/inventory/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DriftReportView, ErpSyncPage, MappingPanel, WaitingOrdersTile } from '../src/admin';
import { erpItem, erpItemMap, erpOutbox, erpSyncRun } from '../src/schema';
import { erpDb } from './helpers';

/** Renders an async server component tree to HTML. */
async function renderHtml(node: React.ReactNode): Promise<string> {
  const { prerenderToNodeStream } = await import('react-dom/static');
  const { prelude } = await prerenderToNodeStream(node);
  let html = '';
  for await (const chunk of prelude) html += chunk;
  return html;
}

let t: TestDb;
const variantId = newId();

beforeAll(async () => {
  t = await erpDb('render');
  await seedLevels([{ variantId, productId: newId(), sku: 'MNG-1', onHand: 10 }]);
  await t.db.insert(erpItem).values([
    { erpItemId: 'ops-1', name: 'Mango', variety: 'Alphonso', available: 4 },
    { erpItemId: 'ops-2', name: 'Guava', variety: null, available: 9 },
  ]);
  await t.db.insert(erpItemMap).values({ variantId, erpItemId: 'ops-1', erpName: 'Mango', mappedBy: 'auto', confidence: 0.92 });
  await t.db.insert(erpOutbox).values([
    { kind: 'order', refId: newId(), status: 'dead', attempts: 10, lastError: 'ERP returned 503' },
    { kind: 'order', refId: newId(), status: 'pending' },
  ]);
  await t.db.insert(erpSyncRun).values({ direction: 'inventory_in', transport: 'fake', finishedAt: new Date(), items: 2, changed: 1 });
});
afterAll(async () => {
  await t?.close();
});

describe('admin views', () => {
  it('sync page shows counts, the dead row with retry, and the run log', async () => {
    const html = await renderHtml(await ErpSyncPage());
    expect(html).toContain('Orders waiting for ERP');
    expect(html).toContain('ERP returned 503');
    expect(html).toContain('Retry');
    expect(html).toContain('Stock in');
    expect(html).toContain('/api/admin/erp/pending-orders');
  });

  it('mapping panel lists the unmapped item and the existing link', async () => {
    const html = await renderHtml(await MappingPanel());
    expect(html).toContain('Unmapped ERP items (1)');
    expect(html).toContain('Guava');
    expect(html).toContain('MNG-1');
    expect(html).toContain('92%');
  });

  it('drift report flags the gap and the tile counts waiting orders', async () => {
    const drift = await renderHtml(await DriftReportView());
    expect(drift).toContain('MNG-1');
    expect(drift).toContain('>6<');
    const tile = await renderHtml(await WaitingOrdersTile());
    expect(tile).toContain('Orders waiting for ops sync');
    expect(tile).toContain('1 in dead letter');
  });
});
