import { getViewer, requirePermission } from '@ecomkit/core/auth-context';
import { db } from '@ecomkit/core/db';
import { count, desc, eq } from 'drizzle-orm';
import { maskPii, type SegmentKey } from '../domain';
import {
  customersVSegmentBulkBuyer,
  customersVSegmentByDistrict,
  customersVSegmentFirstOrder,
  customersVSegmentWizardLeadNoOrder,
} from '../schema';

/** Member counts of the four computed segments. */
export async function segmentCounts(): Promise<Record<SegmentKey, number>> {
  await requirePermission('customers.read');
  const [[a], [b], [c], [d]] = await Promise.all([
    db.select({ n: count() }).from(customersVSegmentFirstOrder),
    db.select({ n: count() }).from(customersVSegmentBulkBuyer),
    db.select({ n: count() }).from(customersVSegmentByDistrict),
    db.select({ n: count() }).from(customersVSegmentWizardLeadNoOrder),
  ]);
  return { first_order: a!.n, bulk_buyer: b!.n, by_district: c!.n, wizard_lead_no_order: d!.n };
}

export interface SegmentMember {
  id: string;
  name: string | null;
  phoneE164: string | null;
  email: string | null;
  detail: string | null;
  createdAt: Date;
}

/** One segment as a list (newest first), personal data masked for the viewer's role. `districtId` narrows by_district. */
export async function segmentMembers(
  key: SegmentKey,
  options: { districtId?: string; page?: number; pageSize?: number } = {},
): Promise<{ rows: SegmentMember[]; total: number }> {
  await requirePermission('customers.read');
  const viewer = await getViewer();
  const pageSize = options.pageSize ?? 50;
  const offset = ((options.page ?? 1) - 1) * pageSize;
  let rows: SegmentMember[];
  let total: number;
  if (key === 'wizard_lead_no_order') {
    const v = customersVSegmentWizardLeadNoOrder;
    const [list, [n]] = await Promise.all([
      db.select().from(v).orderBy(desc(v.createdAt), desc(v.leadId)).limit(pageSize).offset(offset),
      db.select({ n: count() }).from(v),
    ]);
    rows = list.map((r) => ({ id: r.leadId, name: r.name, phoneE164: r.phoneE164, email: null, detail: r.status, createdAt: r.createdAt }));
    total = n!.n;
  } else if (key === 'by_district') {
    const v = customersVSegmentByDistrict;
    const where = options.districtId ? eq(v.districtId, options.districtId) : undefined;
    const [list, [n]] = await Promise.all([
      db.select().from(v).where(where).orderBy(desc(v.createdAt), desc(v.userId)).limit(pageSize).offset(offset),
      db.select({ n: count() }).from(v).where(where),
    ]);
    rows = list.map((r) => ({ id: r.userId, name: r.displayName, phoneE164: r.phoneE164, email: r.email, detail: r.districtText, createdAt: r.createdAt }));
    total = n!.n;
  } else {
    const v = key === 'first_order' ? customersVSegmentFirstOrder : customersVSegmentBulkBuyer;
    const [list, [n]] = await Promise.all([
      db.select().from(v).orderBy(desc(v.createdAt), desc(v.userId)).limit(pageSize).offset(offset),
      db.select({ n: count() }).from(v),
    ]);
    rows = list.map((r) => ({ id: r.userId, name: r.displayName, phoneE164: r.phoneE164, email: r.email, detail: String(r.ordersCount), createdAt: r.createdAt }));
    total = n!.n;
  }
  return { rows: rows.map((r) => maskPii(r, viewer)), total };
}
