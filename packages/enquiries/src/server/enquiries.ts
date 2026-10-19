import { audit } from '@ecomkit/core/audit';
import { getViewer, NotFoundError, requirePermission } from '@ecomkit/core/auth-context';
import type { Viewer } from '@ecomkit/core/contracts';
import { db, withTx } from '@ecomkit/core/db';
import { emit } from '@ecomkit/core/events';
import { createLogger } from '@ecomkit/core/observability';
import { and, count, desc, eq, ilike, inArray, max, or, sql, type SQL } from 'drizzle-orm';
import { ATTACHMENT_LIMITS, ENQUIRY_STATUSES, isStale, quietness, STALE_AFTER_DAYS, type EnquiryFormInput, type EnquiryStatus } from '../domain';
import { enquiriesAttachment, enquiriesEnquiry, enquiriesNote } from '../schema';
import { getPorts, type StoredFile } from './ports';

export type EnquiryRow = typeof enquiriesEnquiry.$inferSelect;
export type AttachmentRow = typeof enquiriesAttachment.$inferSelect;
export type NoteRow = typeof enquiriesNote.$inferSelect;

const log = createLogger('enquiries');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOr404 = (id: string) => {
  if (!UUID_RE.test(id)) throw new NotFoundError();
  return id;
};

export class AttachmentError extends Error {
  constructor(readonly code: 'too_many' | 'too_large' | 'type' | 'store') {
    super(`attachment_${code}`);
    this.name = 'AttachmentError';
  }
}

/** Boundary checks on uploads (count, size, declared type) before anything is stored. */
export function checkAttachments(files: readonly StoredFile[]): void {
  if (files.length > ATTACHMENT_LIMITS.maxFiles) throw new AttachmentError('too_many');
  for (const f of files) {
    if (f.bytes.byteLength > ATTACHMENT_LIMITS.maxBytes) throw new AttachmentError('too_large');
    if (!ATTACHMENT_LIMITS.types.includes(f.type)) throw new AttachmentError('type');
  }
}

/**
 * Stores the enquiry and, when the customers module is wired, its one lead, in one transaction:
 * enquiry row -> `upsertLead` (which emits `lead.created`, the only event that reaches the ERP) ->
 * attachments -> `enquiry.created` (for staff and customer notifications). Files go to private storage
 * first; a failed transaction can leave an orphaned private file, never a half-saved enquiry.
 * ponytail: orphaned files are left for the media module's sweep.
 */
export async function createEnquiry(
  input: EnquiryFormInput,
  ctx: { files?: readonly StoredFile[]; ipHash?: string | null; sourcePath?: string | null; utm?: Record<string, string> } = {},
): Promise<{ enquiryId: string; leadId: string | null }> {
  const { contacts, files: store } = getPorts();
  const files = ctx.files ?? [];
  checkAttachments(files);
  if (files.length && !store) log.warn('attachments dropped: no private file store configured', { count: files.length });
  const stored: { mediaId: string; file: StoredFile }[] = [];
  if (store) {
    for (const file of files) {
      try {
        stored.push({ mediaId: (await store.putPrivate(file, { owner: 'enquiries' })).mediaId, file });
      } catch {
        throw new AttachmentError('store');
      }
    }
  }

  return withTx(async (tx) => {
    const [row] = await tx
      .insert(enquiriesEnquiry)
      .values({
        kind: input.kind,
        name: input.name,
        phoneE164: input.phone,
        email: input.email,
        customerType: input.customerType,
        acres: input.acres,
        locationText: input.location,
        districtId: input.districtId,
        timeline: input.timeline,
        requirement: input.requirement,
        customerNotes: input.notes,
        sourcePath: ctx.sourcePath ?? null,
        utm: ctx.utm ?? {},
        ipHash: ctx.ipHash ?? null,
      })
      .returning({ id: enquiriesEnquiry.id });
    const enquiryId = row!.id;

    let leadId: string | null = null;
    if (contacts) {
      const lead = await contacts.upsertLead(
        {
          name: input.name,
          phone: input.phone,
          source: 'enquiry',
          context: { ref: enquiryId, enquiryId, kind: input.kind, acres: input.acres, district: input.districtId, location: input.location, timeline: input.timeline },
        },
        { tx },
      );
      leadId = lead.leadId;
      await tx.update(enquiriesEnquiry).set({ leadId, phoneHash: lead.phoneHash }).where(eq(enquiriesEnquiry.id, enquiryId));
    }
    if (stored.length) {
      await tx.insert(enquiriesAttachment).values(
        stored.map((s) => ({ enquiryId, mediaId: s.mediaId, fileName: s.file.name.slice(0, 200), contentType: s.file.type, sizeBytes: s.file.bytes.byteLength })),
      );
    }
    await emit('enquiry.created', { enquiryId, leadId }, { tx });
    return { enquiryId, leadId };
  });
}

/** Phone and email as the viewer may see them (support sees masked values; fails closed without customers). */
export function presentEnquiry<T extends { phoneE164: string; email: string | null }>(row: T, viewer: Viewer): T {
  const { contacts } = getPorts();
  if (contacts ? contacts.seesFullPii(viewer) : viewer.kind === 'staff' && viewer.role !== 'support') return row;
  return { ...row, phoneE164: contacts?.maskPhone(row.phoneE164) ?? '••••••', email: row.email ? (contacts?.maskEmail(row.email) ?? '••••••') : null };
}

export type EnquiryListRow = EnquiryRow & { stale: boolean };

export async function listEnquiries(
  options: { q?: string; status?: EnquiryStatus; page?: number; pageSize?: number; now?: Date } = {},
): Promise<{ rows: EnquiryListRow[]; total: number }> {
  await requirePermission('enquiries.read');
  const viewer = await getViewer();
  const pageSize = options.pageSize ?? 25;
  const q = options.q?.trim();
  const qHash = q && q.replace(/\D/g, '').length >= 10 ? (getPorts().contacts?.hashContact(q) ?? null) : null;
  const where = and(
    options.status ? eq(enquiriesEnquiry.status, options.status) : undefined,
    q
      ? or(
          ilike(enquiriesEnquiry.name, `%${q.replace(/[%_\\]/g, '\\$&')}%`),
          ilike(enquiriesEnquiry.locationText, `%${q.replace(/[%_\\]/g, '\\$&')}%`),
          qHash ? eq(enquiriesEnquiry.phoneHash, qHash) : undefined,
        )
      : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(enquiriesEnquiry)
      .where(where)
      .orderBy(desc(enquiriesEnquiry.createdAt), desc(enquiriesEnquiry.id))
      .limit(pageSize)
      .offset(((options.page ?? 1) - 1) * pageSize),
    db.select({ n: count() }).from(enquiriesEnquiry).where(where),
  ]);
  const now = options.now ?? new Date();
  return { rows: rows.map((r) => ({ ...presentEnquiry(r, viewer), stale: isStale(r, now) })), total: total!.n };
}

/** Open enquiries grouped by status for the pipeline board (newest 50 per column). */
export async function pipeline(options: { now?: Date } = {}): Promise<Record<EnquiryStatus, EnquiryListRow[]>> {
  await requirePermission('enquiries.read');
  const viewer = await getViewer();
  const { rows } = await db.execute<{ id: string }>(sql`
    select id from (
      select id, row_number() over (partition by status order by created_at desc, id desc) as n from enquiries_enquiry
    ) ranked where n <= 50`);
  const ids = rows.map((r) => r.id);
  const list = ids.length ? await db.select().from(enquiriesEnquiry).where(inArray(enquiriesEnquiry.id, ids)).orderBy(desc(enquiriesEnquiry.createdAt)) : [];
  const now = options.now ?? new Date();
  const board = Object.fromEntries(ENQUIRY_STATUSES.map((s) => [s, [] as EnquiryListRow[]])) as Record<EnquiryStatus, EnquiryListRow[]>;
  for (const r of list) board[r.status].push({ ...presentEnquiry(r, viewer), stale: isStale(r, now) });
  return board;
}

export async function getEnquiry(rawId: string): Promise<{ enquiry: EnquiryListRow; notes: NoteRow[]; attachments: AttachmentRow[] }> {
  await requirePermission('enquiries.read');
  const viewer = await getViewer();
  const id = idOr404(rawId);
  const [row] = await db.select().from(enquiriesEnquiry).where(eq(enquiriesEnquiry.id, id));
  if (!row) throw new NotFoundError();
  const [notes, attachments] = await Promise.all([
    db.select().from(enquiriesNote).where(eq(enquiriesNote.enquiryId, id)).orderBy(desc(enquiriesNote.createdAt), desc(enquiriesNote.id)),
    db.select().from(enquiriesAttachment).where(eq(enquiriesAttachment.enquiryId, id)).orderBy(enquiriesAttachment.createdAt),
  ]);
  return { enquiry: { ...presentEnquiry(row, viewer), stale: isStale(row, new Date()) }, notes, attachments };
}

/** Moves an enquiry along the pipeline; audited, emits `enquiry.status_changed`. */
export async function transition(rawId: string, to: EnquiryStatus): Promise<void> {
  const staff = await requirePermission('enquiries.write');
  const id = idOr404(rawId);
  if (!ENQUIRY_STATUSES.includes(to)) throw new Error('invalid_status');
  await withTx(async (tx) => {
    const [before] = await tx.select({ status: enquiriesEnquiry.status }).from(enquiriesEnquiry).where(eq(enquiriesEnquiry.id, id)).for('update');
    if (!before) throw new NotFoundError();
    if (before.status === to) return;
    await tx.update(enquiriesEnquiry).set({ status: to, updatedAt: new Date() }).where(eq(enquiriesEnquiry.id, id));
    await audit({ actorId: staff.userId, actorType: 'staff', action: 'enquiry.status', entity: 'enquiry', entityId: id, before, after: { status: to } }, { tx });
    await emit('enquiry.status_changed', { enquiryId: id, from: before.status, to }, { tx });
  });
}

/** Assigns to a staff user id, or clears with null. */
export async function assign(rawId: string, staffUserId: string | null): Promise<void> {
  const staff = await requirePermission('enquiries.write');
  const id = idOr404(rawId);
  if (staffUserId !== null) idOr404(staffUserId);
  await withTx(async (tx) => {
    const res = await tx.update(enquiriesEnquiry).set({ assignedTo: staffUserId, updatedAt: new Date() }).where(eq(enquiriesEnquiry.id, id)).returning({ id: enquiriesEnquiry.id });
    if (!res.length) throw new NotFoundError();
    await audit({ actorId: staff.userId, actorType: 'staff', action: 'enquiry.assign', entity: 'enquiry', entityId: id, after: { assignedTo: staffUserId } }, { tx });
  });
}

/** A staff remark on the enquiry; touching it resets the staleness clock. */
export async function addNote(rawId: string, body: string): Promise<NoteRow> {
  const staff = await requirePermission('enquiries.write');
  const id = idOr404(rawId);
  const text = body.trim();
  if (!text || text.length > 4000) throw new Error('invalid_note');
  return withTx(async (tx) => {
    const res = await tx.update(enquiriesEnquiry).set({ updatedAt: new Date() }).where(eq(enquiriesEnquiry.id, id)).returning({ id: enquiriesEnquiry.id });
    if (!res.length) throw new NotFoundError();
    const [note] = await tx.insert(enquiriesNote).values({ enquiryId: id, authorId: staff.userId, body: text }).returning();
    return note!;
  });
}

/** One attachment's bytes for the admin download route (enquiries.read only; never public). */
export async function readAttachment(rawId: string): Promise<StoredFile> {
  await requirePermission('enquiries.read');
  const id = idOr404(rawId);
  const [att] = await db.select().from(enquiriesAttachment).where(eq(enquiriesAttachment.id, id));
  const file = att ? await getPorts().files?.read(att.mediaId) : null;
  if (!att || !file) throw new NotFoundError();
  return { name: att.fileName, type: att.contentType, bytes: file.bytes };
}

/** Dashboard staleness: when the newest enquiry arrived, and whether that is quiet enough to flag. */
export async function lastEnquiry(now = new Date()): Promise<{ at: Date | null; days: number | null; level: 'ok' | 'amber'; staleOpen: number }> {
  await requirePermission('enquiries.read');
  const openStale: SQL = sql`${enquiriesEnquiry.status} not in ('closed_won', 'closed_lost') and ${enquiriesEnquiry.updatedAt} <= ${new Date(now.getTime() - STALE_AFTER_DAYS * 86_400_000).toISOString()}::timestamptz`;
  const [[last], [stale]] = await Promise.all([
    db.select({ at: max(enquiriesEnquiry.createdAt) }).from(enquiriesEnquiry),
    db.select({ n: count() }).from(enquiriesEnquiry).where(openStale),
  ]);
  const at = last?.at ?? null;
  return { at, ...quietness(at, now), staleOpen: stale!.n };
}
