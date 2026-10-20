import { ForbiddenError, setAuthProvider } from '@ecomkit/core/auth-context';
import { ROLE_PERMISSIONS, type AuthContext, type StaffViewer, type Viewer } from '@ecomkit/core/contracts';
import type { TestDb } from '@ecomkit/core/testing';
import { eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { deleteRow, saveDistance, saveMethod, savePackingRule, saveVehicle, saveZone } from '../src/admin/actions';
import { DeliveryPanel } from '../src/admin';
import { shippingDistanceOverride, shippingPackingRule, shippingVehicle, shippingZone } from '../src/schema';
import { quoteMethods } from '../src/server';
import { seedFixture, shippingDb } from './helpers';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), cacheLife: vi.fn(), cacheTag: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn() }));

const OWNER: StaffViewer = { kind: 'staff', userId: '00000000-0000-7000-8000-00000000abcd', name: 'Owner', email: 'owner@example.test', role: 'owner', permissions: ROLE_PERMISSIONS.owner };
const FULFILMENT: StaffViewer = { ...OWNER, role: 'fulfilment', permissions: ROLE_PERMISSIONS.fulfilment };

function signInAs(viewer: Viewer): void {
  const auth: AuthContext = {
    getViewer: async () => viewer,
    requirePermission: async (perm) => {
      if (viewer.kind !== 'staff' || !viewer.permissions.includes(perm)) throw new ForbiddenError();
      return viewer;
    },
    requireOwner: async () => {
      throw new ForbiddenError();
    },
  };
  setAuthProvider(async () => auth);
}

let t: TestDb;
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeAll(async () => {
  t = await shippingDb('admin');
  await seedFixture();
}, 120_000);

afterAll(async () => {
  await t?.close();
});

describe('Delivery panel', () => {
  it('renders every section with the seeded rows for settings readers, and refuses others', async () => {
    signInAs(OWNER);
    const html = renderToStaticMarkup(await DeliveryPanel());
    for (const text of ['Zones', 'Methods', 'Vehicles', 'Local delivery days', 'Packing rules', 'Distance overrides', 'Medium truck', 'bengaluru-urban', 'mysuru']) expect(html).toContain(text);
    signInAs(FULFILMENT);
    await expect(DeliveryPanel()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('saves vehicles in rupees as paise, audited, and quotes pick the change up', async () => {
    signInAs(OWNER);
    const [medium] = await t.db.select().from(shippingVehicle).where(eq(shippingVehicle.name, 'Medium truck'));
    const res = await saveVehicle(form({ id: medium!.id, name: 'Medium truck', capacity_kg: '2500', local_flat_rs: '3600', per_km_rs: '36.5', is_active: 'on' }));
    expect(res.ok).toBe(true);
    const [after] = await t.db.select().from(shippingVehicle).where(eq(shippingVehicle.id, medium!.id));
    expect(after).toMatchObject({ localFlatPaise: 360_000, perKmPaise: 3_650 });
    const quotes = await quoteMethods({ lines: [], totalWeightKg: 2000, address: { pincode: null, districtSlug: 'mysuru', stateCode: 'KA' } });
    expect(quotes.find((q) => q.kind === 'outstation')?.pricePaise).toBe(150 * 3_650);
    const { rows } = await t.pool.query<{ action: string }>("select action from core_audit_log where entity = 'shipping_vehicle'");
    expect(rows.map((r) => r.action)).toContain('shipping.vehicle.save');
  });

  it('validates input: zone lists, method rules per kind, packing match per scope', async () => {
    signInAs(OWNER);
    const zone = await saveZone(form({ slug: 'goa-coast', name: 'Goa coast', kind: 'enquiry', district_slugs: 'North-Goa, south-goa', state_codes: 'ga', position: '5' }));
    expect(zone.ok).toBe(true);
    const [row] = await t.db.select().from(shippingZone).where(eq(shippingZone.slug, 'goa-coast'));
    expect(row).toMatchObject({ districtSlugs: ['north-goa', 'south-goa'], stateCodes: ['GA'] });

    const badRules = await saveMethod(form({ name: 'x', kind: 'outstation_distance', zone_id: '', rules: '{"minDays":9,"maxDays":2}', position: '0' }));
    expect(badRules).toMatchObject({ ok: false, fieldErrors: { rules: [expect.any(String)] } });
    const badJson = await saveMethod(form({ name: 'x', kind: 'pickup', rules: '{oops' }));
    expect(badJson.ok).toBe(false);

    expect((await savePackingRule(form({ scope: 'size_class', match: '{"productIds":["a"]}', fee_rs: '5' }))).ok).toBe(false);
    expect((await savePackingRule(form({ scope: 'size_class', match: '{"sizeClass":"L"}', fee_rs: '15' }))).ok).toBe(true);
    expect((await t.db.select().from(shippingPackingRule))[0]).toMatchObject({ scope: 'size_class', match: { sizeClass: 'L' }, feePaise: 1500 });
  });

  it('upserts and deletes distance overrides; only settings writers may', async () => {
    signInAs(OWNER);
    expect((await saveDistance(form({ district_slug: 'Hubballi', km: '410', note: '' }))).ok).toBe(true);
    expect((await saveDistance(form({ district_slug: 'hubballi', km: '415', note: 'measured' }))).ok).toBe(true);
    expect(await t.db.select().from(shippingDistanceOverride).where(eq(shippingDistanceOverride.districtSlug, 'hubballi'))).toMatchObject([{ km: 415, note: 'measured' }]);
    signInAs(FULFILMENT);
    expect(await deleteRow(form({ table: 'distance', id: 'hubballi' }))).toMatchObject({ ok: false, formError: 'forbidden' });
    signInAs(OWNER);
    expect(await deleteRow(form({ table: 'distance', id: 'hubballi' }))).toEqual({ ok: true, data: { deleted: true } });
    expect(await t.db.select().from(shippingDistanceOverride).where(eq(shippingDistanceOverride.districtSlug, 'hubballi'))).toEqual([]);
  });
});
