// WP-16 cross-module check: the real enquiry endpoint wired to the real customers module (as the host does at boot)
// creates exactly one customers_lead and exactly one lead.created event per enquiry.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createTestDb, queuedJobs, type TestDb } from '@ecomkit/core/testing';
import { formGuards } from '@ecomkit/core/validation';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// `server-only` throws outside a React server build; stub the copy the packages resolve, then load them.
vi.doMock(createRequire(fileURLToPath(import.meta.resolve('@ecomkit/customers/server'))).resolve('server-only'), () => ({}));
const { contactPort } = await import('@ecomkit/customers/server');
const { configureEnquiries, handleEnquiryPost } = await import('@ecomkit/enquiries/server');

let t: TestDb;

beforeAll(async () => {
  process.env.INTERNAL_SECRET = 's'.repeat(40);
  t = await createTestDb('wp-16-shop-enquiry', { schemas: ['core', 'customers', 'enquiries'] });
  configureEnquiries({ contacts: contactPort });
}, 120_000);
afterAll(async () => {
  await t?.close();
});

function form(phone: string): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries({
    kind: 'farm_development',
    name: 'Shivanna',
    phone,
    acres: '2.5',
    location: 'Tumakuru',
    website: '',
    _ft: formGuards.issue(Date.now() - 5000),
    _return: '/build-farm-with-us',
  }))
    fd.set(k, v);
  return fd;
}
const post = (fd: FormData, ip: string) => handleEnquiryPost(new Request('http://localhost/api/enquiry', { method: 'POST', body: fd, headers: { 'x-real-ip': ip } }));

describe('enquiry -> lead', () => {
  it('creates exactly one lead and one lead.created per enquiry, linked both ways', async () => {
    const res = await post(form('99001 22334'), '192.0.2.10');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/build-farm-with-us?enquiry=sent#enquiry');

    const enquiries = (await t.pool.query('select id, lead_id, phone_hash from enquiries_enquiry')).rows;
    const leads = (await t.pool.query('select id, source, phone_e164, phone_hash, phone_verified, context from customers_lead')).rows;
    expect(enquiries).toHaveLength(1);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ id: enquiries[0].lead_id, source: 'enquiry', phone_e164: '+919900122334', phone_verified: false, phone_hash: enquiries[0].phone_hash });
    expect(leads[0].context).toMatchObject({ enquiryId: enquiries[0].id, ref: enquiries[0].id, acres: 2.5, location: 'Tumakuru' });

    const events = (await queuedJobs(t.db, 'core.event')).map((j) => j.data as { event: string; payload: Record<string, unknown> });
    expect(events.filter((e) => e.event === 'lead.created')).toEqual([expect.objectContaining({ payload: { leadId: leads[0].id, source: 'enquiry' } })]);
    expect(events.filter((e) => e.event === 'enquiry.created')).toEqual([expect.objectContaining({ payload: { enquiryId: enquiries[0].id, leadId: leads[0].id } })]);

    // A second enquiry from the same phone is a new enquiry and a new lead (one per enquiry).
    await post(form('+919900122334'), '192.0.2.11');
    expect((await t.pool.query('select count(*)::int as n from customers_lead')).rows[0].n).toBe(2);
    expect((await queuedJobs(t.db, 'core.event')).filter((j) => (j.data as { event: string }).event === 'lead.created')).toHaveLength(2);
  });
});
