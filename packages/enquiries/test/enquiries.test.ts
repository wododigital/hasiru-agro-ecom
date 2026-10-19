import { createTestDb, queuedJobs, TEST_NOW, type TestDb } from '@ecomkit/core/testing';
import { formGuards } from '@ecomkit/core/validation';
import { listAudit } from '@ecomkit/core/audit';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isStale, quietness, safeReturnPath } from '../src/domain';
import {
  addNote,
  configureEnquiries,
  getEnquiry,
  handleEnquiryPost,
  lastEnquiry,
  listEnquiries,
  pipeline,
  transition,
  type EnquiryContacts,
  type PrivateFileStore,
  type StoredFile,
} from '../src/server';
import { GET as downloadAttachment } from '../src/routes/admin-attachment';
import { asCustomer, asGuest, asStaff } from './viewers';

let t: TestDb;
let ip = 0;

// Recording stand-ins for the two ports the host wires at boot (customers' contactPort, media's private store).
const leadCalls: unknown[] = [];
const contacts: EnquiryContacts = {
  upsertLead: async (input) => {
    leadCalls.push(input);
    return { leadId: '0199f000-0000-7000-8000-00000000ead1', phoneHash: 'hash-of-phone' };
  },
  hashContact: (v) => (v ? 'hash-of-phone' : null),
  maskPhone: (p) => (p ? `${p.slice(0, 5)}•••` : null),
  maskEmail: (e) => (e ? '•••' : null),
  seesFullPii: (v) => v.kind === 'staff' && v.role !== 'support',
};
const privateFiles = new Map<string, StoredFile & { visibility: string }>();
const store: PrivateFileStore = {
  putPrivate: async (file) => {
    const mediaId = `m${privateFiles.size + 1}`;
    privateFiles.set(mediaId, { ...file, visibility: 'private' });
    return { mediaId };
  },
  read: async (mediaId) => privateFiles.get(mediaId) ?? null,
};

function form(over: Record<string, string> = {}, files: File[] = []): FormData {
  const fd = new FormData();
  const values: Record<string, string> = {
    kind: 'farm_development',
    name: 'Nagaraj',
    phone: '98860 11223',
    customerType: 'farmer',
    acres: '4',
    location: 'Near Kanakapura',
    timeline: 'Within 3 months',
    requirement: 'Mango and coconut orchard with drip',
    notes: 'Borewell on site',
    website: '',
    _ft: formGuards.issue(Date.now() - 10_000),
    _return: '/build-farm-with-us?utm_source=ig',
    utm_source: 'instagram',
    utm_campaign: 'oct',
    ...over,
  };
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  for (const f of files) fd.append('files', f);
  return fd;
}

const post = (fd: FormData, headers: Record<string, string> = {}) =>
  handleEnquiryPost(new Request('http://localhost/api/enquiry', { method: 'POST', body: fd, headers: { 'x-real-ip': `198.51.100.${++ip}`, ...headers } }));
const jpeg = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], 'site photo.jpg', { type: 'image/jpeg' });
const count = async (table: string) => (await t.pool.query(`select count(*)::int as n from ${table}`)).rows[0].n as number;
const events = async (name: string) => (await queuedJobs(t.db, 'core.event')).filter((j) => (j.data as { event: string }).event === name);

beforeAll(async () => {
  process.env.INTERNAL_SECRET = 'e'.repeat(40);
  t = await createTestDb('wp-16-enquiries', { schemas: ['core', 'enquiries'] });
});
afterAll(async () => {
  await t?.close();
});
beforeEach(() => {
  configureEnquiries({ contacts, files: store });
  leadCalls.length = 0;
});

describe('public form without JS', () => {
  it('stores the enquiry, asks for exactly one lead, keeps files private and redirects back (303)', async () => {
    const res = await post(form({}, [jpeg()]));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/build-farm-with-us?utm_source=ig&enquiry=sent#enquiry');

    const { rows } = await t.pool.query('select * from enquiries_enquiry');
    expect(rows).toHaveLength(1);
    const e = rows[0];
    expect(e).toMatchObject({
      kind: 'farm_development',
      phone_e164: '+919886011223',
      phone_hash: 'hash-of-phone',
      lead_id: '0199f000-0000-7000-8000-00000000ead1',
      customer_type: 'farmer',
      location_text: 'Near Kanakapura',
      customer_notes: 'Borewell on site',
      source_path: '/build-farm-with-us',
      utm: { utm_source: 'instagram', utm_campaign: 'oct' },
      status: 'new',
    });
    expect(Number(e.acres)).toBe(4);
    expect(e.ip_hash).toMatch(/^[A-Za-z0-9_-]{22}$/);

    // Exactly one lead request, from source enquiry, referencing this enquiry.
    expect(leadCalls).toEqual([expect.objectContaining({ source: 'enquiry', phone: '+919886011223', context: expect.objectContaining({ ref: e.id, enquiryId: e.id }) })]);
    // The enquiry itself emits only enquiry.created (lead.created comes from the lead write; nothing here talks to the ERP).
    expect((await events('enquiry.created')).map((j) => (j.data as { payload: unknown }).payload)).toEqual([{ enquiryId: e.id, leadId: e.lead_id }]);
    expect(await events('lead.created')).toHaveLength(0);

    // Upload went to private storage only.
    const [att] = (await t.pool.query('select * from enquiries_attachment')).rows;
    expect(att).toMatchObject({ enquiry_id: e.id, file_name: 'site photo.jpg', content_type: 'image/jpeg', size_bytes: 7 });
    expect(privateFiles.get(att.media_id)?.visibility).toBe('private');
  });

  it('answers JSON to fetch callers', async () => {
    const res = await post(form({ phone: '9886011224' }), { accept: 'application/json' });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ ok: true, outcome: 'sent', enquiryId: expect.any(String) });
  });

  it('silently drops honeypot hits, rejects a too-fast or forged time token, and validates fields', async () => {
    const before = await count('enquiries_enquiry');
    const bot = await post(form({ website: 'http://spam.example' }));
    expect(bot.headers.get('location')).toContain('enquiry=sent');
    expect(await count('enquiries_enquiry')).toBe(before);

    const fast = await post(form({ _ft: formGuards.issue(Date.now()) }));
    expect(fast.headers.get('location')).toContain('enquiry=retry');
    const forged = await post(form({ _ft: `${Date.now() - 10_000}.forged` }));
    expect(forged.headers.get('location')).toContain('enquiry=retry');

    const bad = await post(form({ phone: '12345', acres: '0' }), { accept: 'application/json' });
    expect(bad.status).toBe(400);
    expect((await bad.json()).fields.sort()).toEqual(['acres', 'phone']);
    expect(await count('enquiries_enquiry')).toBe(before);
    expect(leadCalls).toHaveLength(0);
  });

  it('refuses unsafe return paths (open redirect) and unsupported or too many files', async () => {
    const res = await post(form({ _return: '//evil.example/x' }));
    expect(res.headers.get('location')).toBe('/?enquiry=sent#enquiry');
    expect(safeReturnPath('/\\evil.example')).toBe('/');
    expect(safeReturnPath('https://evil.example')).toBe('/');

    const before = await count('enquiries_enquiry');
    const exe = new File([new Uint8Array([0x4d, 0x5a])], 'x.exe', { type: 'application/x-msdownload' });
    expect((await post(form({}, [exe]))).headers.get('location')).toContain('enquiry=attachment');
    expect((await post(form({}, [jpeg(), jpeg(), jpeg(), jpeg(), jpeg(), jpeg()]))).headers.get('location')).toContain('enquiry=attachment');
    expect(await count('enquiries_enquiry')).toBe(before);
  });

  it('rate limits one IP to 5 posts an hour', async () => {
    const headers = { 'x-real-ip': '203.0.113.77', accept: 'application/json' };
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await post(form({ phone: `98860000${10 + i}` }), headers)).status);
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
  });

  it('still saves the enquiry when the customers module is not wired (no lead, no hash)', async () => {
    configureEnquiries({ contacts: null });
    const res = await post(form({ phone: '9000000001' }), { accept: 'application/json' });
    const { enquiryId } = await res.json();
    const { rows } = await t.pool.query('select lead_id, phone_hash from enquiries_enquiry where id = $1', [enquiryId]);
    expect(rows[0]).toEqual({ lead_id: null, phone_hash: null });
  });
});

describe('admin pipeline', () => {
  it('lists with masking for support, moves status with audit + event, notes reset staleness', async () => {
    asStaff('manager');
    const { rows } = await listEnquiries({ q: 'Nagaraj' });
    const target = rows.at(-1)!;
    expect(target.phoneE164).toBe('+919886011223');
    expect((await listEnquiries({ q: '98860 11223' })).rows.map((r) => r.id)).toContain(target.id);

    asStaff('support');
    expect((await listEnquiries({ q: 'Nagaraj' })).rows.at(-1)!.phoneE164).toBe('+9198•••');
    configureEnquiries({ contacts: null });
    expect((await listEnquiries({ q: 'Nagaraj' })).rows.at(-1)!.phoneE164).toBe('••••••');
    configureEnquiries({ contacts });

    await transition(target.id, 'site_assessment');
    const detail = await getEnquiry(target.id);
    expect(detail.enquiry.status).toBe('site_assessment');
    expect((await listAudit({ entity: 'enquiry', entityId: target.id }))[0]!.action).toBe('enquiry.status');
    expect((await events('enquiry.status_changed')).map((j) => (j.data as { payload: unknown }).payload)).toContainEqual({ enquiryId: target.id, from: 'new', to: 'site_assessment' });

    await addNote(target.id, 'Called, visiting on Saturday');
    expect((await getEnquiry(target.id)).notes.map((n) => n.body)).toEqual(['Called, visiting on Saturday']);

    const board = await pipeline();
    expect(board.site_assessment.map((r) => r.id)).toEqual([target.id]);

    asStaff('catalog_editor');
    await expect(listEnquiries()).rejects.toThrow('forbidden');
    asStaff('fulfilment');
    await expect(transition(target.id, 'closed_won')).rejects.toThrow('forbidden');
  });

  it('flags stale open enquiries and a quiet inbox', async () => {
    expect(isStale({ status: 'new', updatedAt: new Date(TEST_NOW.getTime() - 3 * 86_400_000) }, TEST_NOW)).toBe(true);
    expect(isStale({ status: 'closed_lost', updatedAt: new Date(0) }, TEST_NOW)).toBe(false);
    expect(quietness(null, TEST_NOW)).toEqual({ days: null, level: 'amber' });
    expect(quietness(new Date(TEST_NOW.getTime() - 8 * 86_400_000), TEST_NOW)).toEqual({ days: 8, level: 'amber' });

    asStaff('manager');
    await t.pool.query("update enquiries_enquiry set updated_at = now() - interval '5 days' where name = 'Nagaraj' and status = 'new'");
    const later = new Date(Date.now() + 9 * 86_400_000);
    const tile = await lastEnquiry(later);
    expect(tile.level).toBe('amber');
    expect(tile.days).toBe(9);
    expect(tile.staleOpen).toBeGreaterThan(0);
    expect((await listEnquiries({ status: 'new' })).rows.some((r) => r.stale)).toBe(true);
  });
});

describe('private attachments', () => {
  it('downloads only for staff with enquiries.read, never cached; 404 for everyone else', async () => {
    const [att] = (await t.pool.query('select id from enquiries_attachment')).rows;
    const call = () => downloadAttachment(new Request('http://localhost/x'), { params: Promise.resolve({ id: att.id }) });

    asStaff('fulfilment');
    const ok = await call();
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('private, no-store');
    expect(ok.headers.get('content-disposition')).toContain('attachment;');
    expect(new Uint8Array(await ok.arrayBuffer())[0]).toBe(0xff);

    for (const who of [() => asStaff('catalog_editor'), () => asCustomer(), () => asGuest()]) {
      who();
      expect((await call()).status).toBe(404);
    }
    asStaff('manager');
    expect((await downloadAttachment(new Request('http://localhost/x'), { params: Promise.resolve({ id: 'nope' }) })).status).toBe(404);
  });
});
