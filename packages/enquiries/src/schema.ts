// Enquiries tables (BUILD-PLAN section 3, "enquiries"). Every table is prefixed enquiries_.
// lead_id, district_id, media_id and author/assignee ids point into other modules (customers, places,
// media, auth), which may be disabled, so they carry no foreign keys.
import { index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { newId } from '@ecomkit/core/ids';
import { ENQUIRY_KINDS, ENQUIRY_STATUSES } from './domain';

const id = () => uuid('id').primaryKey().$defaultFn(newId);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const enquiriesKind = pgEnum('enquiries_kind', ENQUIRY_KINDS);
export const enquiriesStatus = pgEnum('enquiries_status', ENQUIRY_STATUSES);

export const enquiriesEnquiry = pgTable(
  'enquiries_enquiry',
  {
    id: id(),
    kind: enquiriesKind('kind').notNull(),
    name: text('name').notNull(),
    phoneE164: text('phone_e164').notNull(),
    phoneHash: text('phone_hash'),
    email: text('email'),
    customerType: text('customer_type'),
    acres: numeric('acres', { mode: 'number' }),
    locationText: text('location_text'),
    districtId: uuid('district_id'),
    timeline: text('timeline'),
    requirement: text('requirement'),
    /** Free notes the visitor typed (staff remarks live in enquiries_note). */
    customerNotes: text('customer_notes'),
    status: enquiriesStatus('status').notNull().default('new'),
    assignedTo: uuid('assigned_to'),
    sourcePath: text('source_path'),
    utm: jsonb('utm').$type<Record<string, string>>().notNull().default({}),
    leadId: uuid('lead_id'),
    ipHash: text('ip_hash'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('enquiries_enquiry_status_idx').on(t.status, t.createdAt.desc()),
    index('enquiries_enquiry_list_idx').on(t.createdAt.desc(), t.id.desc()),
    index('enquiries_enquiry_phone_idx').on(t.phoneHash),
    index('enquiries_enquiry_lead_idx').on(t.leadId),
  ],
);

export const enquiriesAttachment = pgTable(
  'enquiries_attachment',
  {
    id: id(),
    enquiryId: uuid('enquiry_id')
      .notNull()
      .references(() => enquiriesEnquiry.id, { onDelete: 'cascade' }),
    mediaId: text('media_id').notNull(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('enquiries_attachment_enquiry_idx').on(t.enquiryId)],
);

export const enquiriesNote = pgTable(
  'enquiries_note',
  {
    id: id(),
    enquiryId: uuid('enquiry_id')
      .notNull()
      .references(() => enquiriesEnquiry.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id'),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('enquiries_note_enquiry_idx').on(t.enquiryId, t.createdAt.desc())],
);

