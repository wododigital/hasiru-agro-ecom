import { eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenError, setAuthProvider } from '@ecomkit/core/auth-context';
import type { Permission, StaffViewer } from '@ecomkit/core/contracts';
import { newId } from '@ecomkit/core/ids';
import { coreAuditLog } from '@ecomkit/core/schema';
import { createTestDb, queuedJobs, type TestDb } from '@ecomkit/core/testing';
import { savePricingAction } from '../src/admin/actions';
import manifest from '../src/manifest';
import { pricingPrice, pricingTier } from '../src/schema';
import {
  configurePricing,
  getAdminPricing,
  getPrice,
  getPrices,
  priceLines,
  priceSnapshot,
  pricingReader,
  saveVariantPricing,
  tierFor,
  UnpricedLineError,
} from '../src/server/pricing';

let t: TestDb;
const PRODUCT = newId();
const V1 = newId();
const V2 = newId();
const STAFF = newId();

function signIn(permissions: Permission[] | null) {
  setAuthProvider(async () => ({
    getViewer: async () => (permissions ? staff(permissions) : { kind: 'guest' }),
    requirePermission: async (perm) => {
      if (!permissions?.includes(perm)) throw new ForbiddenError();
      return staff(permissions);
    },
    requireOwner: async () => {
      throw new ForbiddenError();
    },
  }));
}
const staff = (permissions: Permission[]): StaffViewer => ({ kind: 'staff', userId: STAFF, name: 'Test', email: 't@example.com', role: 'manager', permissions });

const base = { productId: PRODUCT, variantId: V1, pricePaise: 49_000, compareAtPaise: 70_000, offlinePricePaise: 35_000, costPaise: 20_000, tiers: [{ minQty: 50, unitPaise: 35_500 }, { minQty: 100, unitPaise: 34_000 }] };

beforeAll(async () => {
  t = await createTestDb('wp-06-pricing', { schemas: ['core', 'pricing'] });
  configurePricing({
    gstRates: async (ids) => Object.fromEntries(ids.map((id) => [id, 5])),
    variantsOf: async (id) => (id === PRODUCT ? [{ variantId: V1, label: 'Grafted sapling' }, { variantId: V2, label: 'Seedling' }] : []),
  });
}, 120_000);

afterAll(async () => {
  setAuthProvider(async () => null);
  await t?.close();
});

beforeEach(() => signIn(null));

describe('saving prices', () => {
  it('first save writes price + tiers, one audit row, one price.changed event', async () => {
    expect(await saveVariantPricing(base, { actorId: STAFF })).toEqual({ changed: true });
    const tiers = await t.db.select().from(pricingTier).where(eq(pricingTier.variantId, V1));
    expect(tiers.map((r) => [r.minQty, r.unitPricePaise]).sort()).toEqual([[100, 34_000], [50, 35_500]].sort());
    const audits = await t.db.select().from(coreAuditLog).where(eq(coreAuditLog.entityId, V1));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: 'price.update', entity: 'variant', actorId: STAFF, before: null });
    expect(audits[0]!.after).toMatchObject({ pricePaise: 49_000, offlinePricePaise: 35_000 });
    const events = (await queuedJobs(t.db, 'core.event')).filter((j) => (j.data as { event: string }).event === 'price.changed');
    expect(events).toHaveLength(1);
    expect((events[0]!.data as { payload: unknown }).payload).toEqual({ productId: PRODUCT, variantId: V1 });
  });

  it('saving identical values records nothing', async () => {
    expect(await saveVariantPricing(base, { actorId: STAFF })).toEqual({ changed: false });
    expect(await t.db.select().from(coreAuditLog).where(eq(coreAuditLog.entityId, V1))).toHaveLength(1);
  });

  it('a change is audited with before and after', async () => {
    await saveVariantPricing({ ...base, pricePaise: 52_000, tiers: [{ minQty: 50, unitPaise: 37_000 }] }, { actorId: STAFF });
    const audits = await t.db.select().from(coreAuditLog).where(eq(coreAuditLog.entityId, V1));
    expect(audits).toHaveLength(2);
    const last = audits.find((a) => (a.after as { pricePaise: number }).pricePaise === 52_000)!;
    expect(last.before).toMatchObject({ pricePaise: 49_000, tiers: [{ minQty: 50 }, { minQty: 100 }] });
    expect(last.after).toMatchObject({ tiers: [{ minQty: 50, unitPaise: 37_000 }] });
    await saveVariantPricing(base, { actorId: STAFF });
  });

  it('rejects invalid input before touching the database', async () => {
    await expect(saveVariantPricing({ ...base, compareAtPaise: 1 }, { actorId: STAFF })).rejects.toThrow();
    const [row] = await t.db.select().from(pricingPrice).where(eq(pricingPrice.variantId, V1));
    expect(row!.compareAtPaise).toBe(70_000);
  });
});

describe('reading prices', () => {
  it('quotes carry GST from the catalog hook and never the offline or cost price', async () => {
    const q = await getPrice(V1, 49);
    expect(q).toMatchObject({ productId: PRODUCT, unitPaise: 49_000, gstRatePct: 5, nextTier: { qtyToGo: 1 } });
    expect(JSON.stringify(q)).not.toMatch(/offline|cost|35000|20000/i);
    expect((await getPrice(V1, 50))!.unitPaise).toBe(35_500);
    expect(await tierFor(V1, 100)).toEqual({ minQty: 100, unitPaise: 34_000 });
    expect(await getPrice(V2, 1)).toBeNull();
  });

  it('getPrices sums repeated variants before choosing the tier', async () => {
    const r = await pricingReader.getPrices([{ variantId: V1, qty: 30 }, { variantId: V1, qty: 25 }, { variantId: V2, qty: 1 }]);
    expect(r[V1]).toMatchObject({ qty: 55, unitPaise: 35_500 });
    expect(r[V2]).toBeUndefined();
    expect(await getPrices([])).toEqual({});
  });

  it('priceLines applies the cross-line sum per line; priceSnapshot refuses unpriced lines', async () => {
    const q = await priceLines([{ lineId: 'a', variantId: V1, qty: 30 }, { lineId: 'b', variantId: V1, qty: 25 }]);
    expect(q.a).toMatchObject({ qty: 30, unitPaise: 35_500, lineTotalPaise: 30 * 35_500 });
    const snap = await priceSnapshot([{ lineId: 'a', variantId: V1, qty: 30 }, { lineId: 'b', variantId: V1, qty: 25 }]);
    expect(snap[1]).toEqual({ lineId: 'b', productId: PRODUCT, variantId: V1, qty: 25, listUnitPaise: 49_000, tierUnitPaise: 35_500, gstRatePct: 5 });
    await expect(priceSnapshot([{ lineId: 'x', variantId: V2, qty: 1 }])).rejects.toBeInstanceOf(UnpricedLineError);
  });
});

describe('admin', () => {
  it('offline and cost prices are staff-only', async () => {
    await expect(getAdminPricing(PRODUCT)).rejects.toBeInstanceOf(ForbiddenError);
    signIn(['products.read']);
    const rows = await getAdminPricing(PRODUCT);
    expect(rows[0]).toMatchObject({ variantId: V1, offlinePricePaise: 35_000, costPaise: 20_000 });
    expect(rows[1]).toMatchObject({ variantId: V2, pricePaise: null, tiers: [] });
  });

  it('the form action needs pricing.write and saves rupee input', async () => {
    const form = () => {
      const f = new FormData();
      for (const [k, v] of [['productId', PRODUCT], ['variantId', V2], ['price', '120'], ['compareAt', ''], ['offlinePrice', '90'], ['cost', ''], ['tierMinQty', '200'], ['tierPrice', '86.5']] as const) f.append(k, v);
      return f;
    };
    signIn(['products.read']);
    expect(await savePricingAction(null, form())).toMatchObject({ ok: false, formError: 'forbidden' });
    signIn(['products.read', 'pricing.write']);
    expect(await savePricingAction(null, form())).toEqual({ ok: true, data: { changed: true } });
    expect((await getPrice(V2, 200))!.unitPaise).toBe(8_650);
    const bad = form();
    bad.set('price', 'abc');
    const res = await savePricingAction(null, bad);
    expect(res.ok).toBe(false);
    expect(res.ok ? null : res.fieldErrors.pricePaise).toBeTruthy();
  });

  it('the Pricing tab is a productFormTab that renders a form per variant', async () => {
    signIn(['products.read', 'pricing.write']);
    const tab = manifest.productFormTabs[0];
    expect(tab).toMatchObject({ id: 'pricing', label: 'Pricing', permission: 'pricing.write' });
    const Tab = await tab.component();
    const html = renderToStaticMarkup(await (Tab as (p: { productId: string | null }) => Promise<React.ReactElement>)({ productId: PRODUCT }));
    expect(html.match(/<form/g)).toHaveLength(2);
    expect(html).toContain('name="offlinePrice"');
    expect(html).toContain('value="350"');
    const empty = renderToStaticMarkup(await (Tab as (p: { productId: string | null }) => Promise<React.ReactElement>)({ productId: null }));
    expect(empty).toContain('Save the product first');
  });

  it('provides the pricing service', async () => {
    expect(await manifest.provides.pricing()).toBe(pricingReader);
  });
});
