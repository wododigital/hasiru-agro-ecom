import type { Tx } from '@ecomkit/core/db';
import type { Viewer } from '@ecomkit/core/contracts';

/**
 * What enquiries needs from the customers module (`contactPort` from `@ecomkit/customers/server` matches
 * this shape). Customers is optional, so the host passes it in at boot instead of this package importing it.
 */
export interface EnquiryContacts {
  upsertLead(
    input: { name: string; phone: string; source: 'enquiry'; context: Record<string, unknown> },
    options: { tx?: Tx },
  ): Promise<{ leadId: string; phoneHash: string }>;
  hashContact(value: string | null | undefined): string | null;
  maskPhone(phone: string | null | undefined): string | null;
  maskEmail(email: string | null | undefined): string | null;
  seesFullPii(viewer: Viewer): boolean;
}

export interface StoredFile {
  name: string;
  type: string;
  bytes: Uint8Array;
}

/**
 * Private file storage from the media module: files outside the web root, never served by /media,
 * read back only through the permission-checked admin download route. The store sniffs bytes and
 * refuses what it cannot verify (throws).
 */
export interface PrivateFileStore {
  putPrivate(file: StoredFile, meta: { owner: string }): Promise<{ mediaId: string }>;
  read(mediaId: string): Promise<StoredFile | null>;
}

const ports: { contacts: EnquiryContacts | null; files: PrivateFileStore | null } = { contacts: null, files: null };

/**
 * Called once at app boot (instrumentation / worker):
 * `configureEnquiries({ contacts: contactPort, files: mediaPrivateStore })`.
 * Without contacts no lead is created; without files attachments are not accepted.
 */
export function configureEnquiries(next: Partial<typeof ports>): void {
  Object.assign(ports, next);
}

export const getPorts = () => ports;
