import { newId } from '@ecomkit/core/ids';
import type { TestDb } from '@ecomkit/core/testing';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InventoryTab } from '../src/admin';
import { inventoryMessages } from '../src/messages';
import { setLevel } from '../src/server';
import { NotifyMeSection } from '../src/ui';
import { inventoryDb, makeLevel } from './helpers';

let t: TestDb;
const html = async (el: Promise<ReactElement | null>) => {
  const node = await el;
  return node ? renderToStaticMarkup(node) : '';
};

beforeAll(async () => {
  t = await inventoryDb('render');
});

afterAll(async () => {
  await t?.close();
});

describe('Inventory product form tab', () => {
  it('asks to save first for a new product, and shows an empty state without levels', async () => {
    expect(await html(InventoryTab({ productId: null }))).toContain('Save the product first');
    expect(await html(InventoryTab({ productId: newId() }))).toContain('No stock record yet');
  });

  it('shows each variant with its numbers, the manual-wins badge and Clear override', async () => {
    const v = await makeLevel(9, { sku: 'TAB-01' });
    let out = await html(InventoryTab({ productId: v.productId }));
    expect(out).toContain('TAB-01');
    expect(out).not.toContain('Manual wins');
    expect(out).not.toContain('Clear override');
    await setLevel({ variantId: v.variantId, productId: v.productId, onHand: 4 }, null);
    out = await html(InventoryTab({ productId: v.productId }));
    expect(out).toContain('Manual wins');
    expect(out).toContain('Clear override');
    expect(out).toContain(`/admin/inventory/${v.variantId}`);
  });
});

describe('Notify-me PDP section', () => {
  it('renders the form with the preorder note when nothing is sellable', async () => {
    const v = await makeLevel(0, { readyInDays: 20 });
    const out = await html(NotifyMeSection({ productId: v.productId, slug: 'x' }));
    expect(out).toContain(inventoryMessages.notifyMe.submit);
    expect(out).toContain(inventoryMessages.preorder(20));
    expect(out).toContain('data-cta="notify-me-submit"');
  });

  it('renders nothing while any variant is sellable', async () => {
    const v = await makeLevel(2);
    expect(await html(NotifyMeSection({ productId: v.productId, slug: 'x' }))).toBe('');
  });
});
