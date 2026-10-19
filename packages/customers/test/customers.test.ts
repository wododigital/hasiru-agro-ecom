import { NotFoundError } from '@ecomkit/core/auth-context';
import { listAudit } from '@ecomkit/core/audit';
import { createTestDb, queuedJobs, type TestDb } from '@ecomkit/core/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { maskEmail, maskPhone } from '../src/domain';
import {
  consentHistory,
  deleteMyAddress,
  deleteMyLand,
  ensureProfile,
  exportCustomerData,
  getCustomer,
  hasConsent,
  listCustomers,
  listLeads,
  listMyAddresses,
  listMyLand,
  recordConsent,
  recordOrder,
  saveMyAddress,
  saveMyLand,
  segmentCounts,
  segmentMembers,
  setLeadStatus,
  updateMyProfile,
  upsertLead,
} from '../src/server';
import { asCustomer, asGuest, asStaff } from './viewers';

let t: TestDb;
const eventsNamed = async (name: string) =>
  (await queuedJobs(t.db, 'core.event')).filter((j) => (j.data as { event: string }).event === name).map((j) => (j.data as { payload: unknown }).payload);

beforeAll(async () => {
  process.env.INTERNAL_SECRET = 'c'.repeat(40);
  t = await createTestDb('wp-16-customers', { schemas: ['core', 'customers'] });
});
afterAll(async () => {
  await t?.close();
});

const address = (over: Record<string, unknown> = {}) => ({
  name: 'Asha',
  phone: '98450 12345',
  line1: 'Survey no 12',
  pincode: '562123',
  districtText: 'Bengaluru Rural',
  districtId: '0199f000-0000-7000-8000-000000000001',
  state: 'Karnataka',
  ...over,
});

describe('profiles: hashes and masking by role', () => {
  it('stores plain + hashed contacts and masks them for support, not for manager', async () => {
    const me = asCustomer();
    await ensureProfile({ userId: me.customerId, name: 'Ravi', phone: '+91 98765 43210', email: 'Ravi@Example.com' });
    expect((await ensureProfile({ userId: me.customerId })).created).toBe(false);
    expect(await eventsNamed('customer.created')).toEqual([{ customerId: me.customerId }]);

    asStaff('manager');
    const full = await getCustomer(me.customerId);
    expect(full).toMatchObject({ phoneE164: '+919876543210', email: 'ravi@example.com' });
    expect(full!.phoneHash).toMatch(/^[A-Za-z0-9_-]{22}$/);

    asStaff('support');
    const masked = await getCustomer(me.customerId);
    expect(masked!.phoneE164).toBe(maskPhone('+919876543210'));
    expect(masked!.phoneE164).toBe('+91 98•••••210');
    expect(masked!.email).toBe(maskEmail('ravi@example.com'));
    expect(masked!.email).toBe('r•••@example.com');

    // Search by any spelling of the phone finds the row through the hash, still masked for support.
    const found = await listCustomers({ q: '09876543210' });
    expect(found.rows.map((r) => r.userId)).toEqual([me.customerId]);
    expect(found.rows[0]!.phoneE164).toBe('+91 98•••••210');

    asStaff('catalog_editor');
    await expect(getCustomer(me.customerId)).rejects.toThrow('forbidden');
    asStaff('support');
    await expect(exportCustomerData(me.customerId)).rejects.toThrow('forbidden');
    asStaff('owner');
    expect((await exportCustomerData(me.customerId)).profile.email).toBe('ravi@example.com');
  });

  it('lets a customer edit their own profile (validated, audited) and nothing else', async () => {
    const me = asCustomer();
    const row = await updateMyProfile({ displayName: 'Meena', customerType: 'business', gstin: '29abcde1234f1z5', email: '' });
    expect(row).toMatchObject({ userId: me.customerId, displayName: 'Meena', gstin: '29ABCDE1234F1Z5', email: null });
    await expect(updateMyProfile({ displayName: 'Meena', customerType: 'business', gstin: 'NOT-A-GSTIN' })).rejects.toThrow();
    expect((await listAudit({ entity: 'customer', entityId: me.customerId }))[0]!.action).toBe('customer.update');
    asGuest();
    await expect(updateMyProfile({ displayName: 'X', customerType: 'farmer' })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('addresses: district link, default handling, IDOR', () => {
  it('keeps one default and links the district', async () => {
    asCustomer();
    const a = await saveMyAddress(address());
    expect(a).toMatchObject({ isDefault: true, phone: '+919845012345', districtId: '0199f000-0000-7000-8000-000000000001', districtText: 'Bengaluru Rural' });
    const b = await saveMyAddress(address({ line1: 'Plot 4', isDefault: 'on' }));
    const list = await listMyAddresses();
    expect(list.map((r) => [r.id, r.isDefault])).toEqual([
      [b.id, true],
      [a.id, false],
    ]);
    await deleteMyAddress(b.id);
    expect((await listMyAddresses()).map((r) => [r.id, r.isDefault])).toEqual([[a.id, true]]);
    await expect(saveMyAddress(address({ pincode: '012345' }))).rejects.toThrow();
  });

  it('refuses another customer’s address with 404 on read, update and delete', async () => {
    asCustomer();
    const owned = await saveMyAddress(address({ line1: 'Owner farm' }));
    const intruder = asCustomer();
    expect(await listMyAddresses()).toEqual([]);
    await expect(saveMyAddress(address({ id: owned.id, line1: 'Hijacked' }))).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteMyAddress(owned.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteMyAddress('not-a-uuid')).rejects.toBeInstanceOf(NotFoundError);
    expect(intruder.customerId).not.toBe(owned.userId);
    const [still] = await t.pool.query('select line1 from customers_address where id = $1', [owned.id]).then((r) => r.rows);
    expect(still.line1).toBe('Owner farm');
    asGuest();
    await expect(listMyAddresses()).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('land profiles', () => {
  it('saves, lists and scopes land profiles to the owner', async () => {
    asCustomer();
    const land = await saveMyLand({ label: 'Main plot', sqft: '43560', purpose: 'food-forest' });
    expect(land).toMatchObject({ label: 'Main plot', sqft: 43560, purpose: 'food-forest' });
    expect(await listMyLand()).toHaveLength(1);
    asCustomer();
    await expect(saveMyLand({ id: land.id, label: 'Mine now', sqft: 1 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteMyLand(land.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await listMyLand()).toEqual([]);
  });
});

describe('consent: the single store, append-only and audited', () => {
  it('grants, revokes and re-reads through hasConsent with a full history and audit trail', async () => {
    const subject = { phone: '9900011122' };
    expect(await hasConsent(subject, 'marketing')).toBe(false);
    const granted = await recordConsent({ subject, purpose: 'marketing', granted: true, textShown: 'Send me offers on WhatsApp (text 2026-10)', source: 'checkout', ipHash: 'iphash' });
    expect(await hasConsent({ phone: '+91 99000 11122' }, 'marketing')).toBe(true);
    expect(await hasConsent(subject, 'order_updates')).toBe(false);

    // A signed-in customer with the same phone sees the same consent.
    const me = asCustomer();
    expect(await hasConsent({ userId: me.customerId, phone: '9900011122' }, 'marketing')).toBe(true);

    const revoked = await recordConsent({ subject: { userId: me.customerId, phone: '9900011122' }, purpose: 'marketing', granted: false, textShown: 'Unsubscribe', source: 'account' });
    expect(await hasConsent(subject, 'marketing')).toBe(false);

    const history = await consentHistory({ userId: me.customerId, phone: '9900011122' });
    expect(history.map((r) => r.status)).toEqual(['revoked', 'granted']);
    expect(history[1]).toMatchObject({ textShown: 'Send me offers on WhatsApp (text 2026-10)', source: 'checkout', ipHash: 'iphash' });

    const trail = [...(await listAudit({ entity: 'consent', entityId: granted.id })), ...(await listAudit({ entity: 'consent', entityId: revoked.id }))];
    expect(trail.map((a) => a.action).sort()).toEqual(['consent.grant', 'consent.revoke']);
    expect(await eventsNamed('consent.changed')).toEqual(
      expect.arrayContaining([
        { customerId: null, leadId: null, purpose: 'marketing', granted: true },
        { customerId: me.customerId, leadId: null, purpose: 'marketing', granted: false },
      ]),
    );
    // The table is append-only from the API: two rows, nothing overwritten.
    const { rows } = await t.pool.query('select count(*)::int as n from customers_consent where purpose = $1', ['marketing']);
    expect(rows[0].n).toBe(2);
    await expect(recordConsent({ subject: {}, purpose: 'marketing', granted: true, textShown: 'x', source: 'x' })).rejects.toThrow();
  });
});

describe('leads', () => {
  it('creates one lead per ref, upgrades phone_verified, emits lead.created once, masks for support', async () => {
    const before = (await eventsNamed('lead.created')).length;
    const first = await upsertLead({ name: 'Kumar', phone: '9811122233', source: 'wizard', context: { ref: 'plan-1', district: 'mysuru' } });
    const again = await upsertLead({ name: 'Kumar S', phone: '+919811122233', source: 'wizard', phoneVerified: true, context: { ref: 'plan-1' } });
    expect(again).toMatchObject({ leadId: first.leadId, created: false });
    const other = await upsertLead({ name: 'Kumar', phone: '9811122233', source: 'wizard', context: { ref: 'plan-2' } });
    expect(other.created).toBe(true);
    expect((await eventsNamed('lead.created')).length).toBe(before + 2);

    asStaff('manager');
    const { rows } = await listLeads({ source: 'wizard' });
    const lead = rows.find((r) => r.id === first.leadId)!;
    expect(lead).toMatchObject({ name: 'Kumar S', phoneVerified: true, phoneE164: '+919811122233', context: { ref: 'plan-1', district: 'mysuru' } });
    asStaff('support');
    expect((await listLeads({ source: 'wizard' })).rows[0]!.phoneE164).toContain('•');
    await setLeadStatus(first.leadId, 'contacted');
    asStaff('fulfilment');
    await expect(setLeadStatus(first.leadId, 'closed')).rejects.toThrow('forbidden');
  });
});

describe('segments (SQL views)', () => {
  it('computes first order, bulk buyer, by district and wizard lead without an order', async () => {
    const one = asCustomer();
    await ensureProfile({ userId: one.customerId, name: 'One order', phone: '9700000001' });
    await recordOrder({ userId: one.customerId, amountPaise: 150000, at: new Date('2026-10-01T10:00:00Z') });
    await saveMyAddress(address({ districtId: '0199f000-0000-7000-8000-0000000000aa', districtText: 'Mysuru' }));

    const bulk = asCustomer();
    await ensureProfile({ userId: bulk.customerId, name: 'Bulk', phone: '9700000002' });
    await recordOrder({ userId: bulk.customerId, amountPaise: 2000000, at: new Date('2026-10-02T10:00:00Z') });
    await recordOrder({ userId: bulk.customerId, amountPaise: 600000, at: new Date('2026-10-03T10:00:00Z') });

    // A wizard lead whose phone already bought is not in the "no order" segment; a fresh one is.
    await upsertLead({ name: 'Bought', phone: '9700000002', source: 'wizard', context: { ref: 'p-b' } });
    const fresh = await upsertLead({ name: 'Fresh', phone: '9700000003', source: 'wizard', context: { ref: 'p-f' } });

    asStaff('manager');
    const firstOrder = await segmentMembers('first_order');
    expect(firstOrder.rows.map((r) => r.id)).toContain(one.customerId);
    expect(firstOrder.rows.map((r) => r.id)).not.toContain(bulk.customerId);
    expect((await segmentMembers('bulk_buyer')).rows.map((r) => r.id)).toEqual([bulk.customerId]);
    const mysuru = await segmentMembers('by_district', { districtId: '0199f000-0000-7000-8000-0000000000aa' });
    expect(mysuru.rows).toMatchObject([{ id: one.customerId, detail: 'Mysuru' }]);
    const wizard = (await segmentMembers('wizard_lead_no_order')).rows.map((r) => r.id);
    expect(wizard).toContain(fresh.leadId);
    const counts = await segmentCounts();
    expect(counts.bulk_buyer).toBe(1);
    expect(counts.wizard_lead_no_order).toBe(wizard.length);
    const { rows } = await t.pool.query("select count(*)::int as n from customers_v_segment_wizard_lead_no_order where name = 'Bought'");
    expect(rows[0].n).toBe(0);
  });
});
