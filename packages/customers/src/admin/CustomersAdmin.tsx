// Admin pages for customers, leads, segments and consent (admin copy is English-only, exempt from messages).
import { asPaise, formatINR } from '@ecomkit/core/money';
import { Badge, Button, Card, DataTable, DetailFrame, Select, Stat, type Column } from '@ecomkit/ui';
import { parseTableParams, type SearchParamsInput } from '@ecomkit/ui/domain';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CONSENT_PURPOSES, CUSTOMER_TYPES, LEAD_SOURCES, LEAD_STATUSES, SEGMENT_KEYS, type ConsentPurpose, type LeadSource, type LeadStatus, type SegmentKey } from '../domain';
import {
  getCustomer,
  listConsent,
  listCustomers,
  listLeads,
  segmentCounts,
  segmentMembers,
  type ConsentRow,
  type CustomerRow,
  type LeadRow,
  type SegmentMember,
} from '../server';

import { CUSTOMER_VIEWS } from '../server/profiles';
import { setLeadStatusAction } from './actions';

const PAGE = 25;
const when = (d: Date | null) => (d ? d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '-');
const Title = ({ children }: { children: string }) => <h1 className="text-2xl font-semibold">{children}</h1>;

/** /admin/customers (Shopify index): saved views, search (name, or exact phone / email), type filter, whole-row click. Phones masked for support. */
export async function CustomersListPage({ searchParams }: { searchParams: SearchParamsInput }) {
  const params = parseTableParams(searchParams, { filters: { view: CUSTOMER_VIEWS, type: CUSTOMER_TYPES } });
  const { rows, total } = await listCustomers({
    q: params.q,
    view: params.filters.view as (typeof CUSTOMER_VIEWS)[number] | undefined,
    type: params.filters.type as (typeof CUSTOMER_TYPES)[number] | undefined,
    page: params.page,
    pageSize: PAGE,
  });
  const columns: Column<CustomerRow>[] = [
    { id: 'name', header: 'Name', cell: (r) => r.displayName ?? 'Unnamed' },
    { id: 'phone', header: 'Phone', cell: (r) => r.phoneE164 ?? '-' },
    { id: 'type', header: 'Type', cell: (r) => <Badge tone="outline">{r.customerType}</Badge> },
    { id: 'orders', header: 'Orders', align: 'right', cell: (r) => r.ordersCount },
    { id: 'spent', header: 'Spent', align: 'right', cell: (r) => formatINR(asPaise(r.lifetimePaise)) },
    { id: 'since', header: 'Since', cell: (r) => when(r.createdAt) },
  ];
  return (
    <div className="flex flex-col gap-4">
      <Title>Customers</Title>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.userId}
        rowHref={(r) => `/admin/customers/${r.userId}`}
        params={params}
        total={total}
        pageSize={PAGE}
        basePath="/admin/customers"
        views={[
          { id: 'repeat', label: 'Repeat buyers', filters: { view: 'repeat' } },
          { id: 'no_orders', label: 'No orders yet', filters: { view: 'no_orders' } },
          { id: 'farmer', label: 'Farmers', filters: { type: 'farmer' } },
          { id: 'business', label: 'Businesses', filters: { type: 'business' } },
        ]}
        filters={[{ key: 'type', label: 'Type', options: CUSTOMER_TYPES.map((t) => ({ value: t, label: t })) }]}
      />
    </div>
  );
}

/** /admin/customers/[id] (detail frame): contact and business details beside the order summary. */
export async function CustomerDetailPage({ id }: { id: string }) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const c = await getCustomer(id);
  if (!c) notFound();
  const list = (rows: [string, string][]) => (
    <dl className="grid grid-cols-[9rem_1fr] gap-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
  return (
    <DetailFrame
      title={c.displayName ?? 'Customer'}
      backHref="/admin/customers"
      backLabel="Customers"
      meta={`Customer since ${when(c.createdAt)}`}
      badges={<Badge tone="outline">{c.customerType}</Badge>}
      aside={
        <>
          <Card title="Contact">{list([['Phone', c.phoneE164 ?? '-'], ['Email', c.email ?? '-'], ['Source', c.source ?? '-']])}</Card>
          <Card title="Business">{list([['GSTIN', c.gstin ?? '-'], ['Business name', c.legalName ?? '-']])}</Card>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Stat label="Orders" value={c.ordersCount} />
        <Stat label="Lifetime spend" value={formatINR(asPaise(c.lifetimePaise))} />
      </div>
      <Card title="Orders">{list([['First order', when(c.firstOrderAt)], ['Last order', when(c.lastOrderAt)]])}</Card>
    </DetailFrame>
  );
}

export async function LeadsPage({ searchParams }: { searchParams: SearchParamsInput }) {
  const params = parseTableParams(searchParams, { filters: { status: LEAD_STATUSES, source: LEAD_SOURCES } });
  const { rows, total } = await listLeads({
    status: params.filters.status as LeadStatus | undefined,
    source: params.filters.source as LeadSource | undefined,
    page: params.page,
    pageSize: PAGE,
  });
  const columns: Column<LeadRow>[] = [
    { id: 'name', header: 'Name', cell: (r) => r.name },
    { id: 'phone', header: 'Phone', cell: (r) => r.phoneE164 },
    { id: 'verified', header: 'Verified', cell: (r) => (r.phoneVerified ? <Badge tone="success">Verified</Badge> : <Badge tone="outline">Not verified</Badge>) },
    { id: 'source', header: 'Source', cell: (r) => r.source },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => (
        <form action={setLeadStatusAction} className="flex items-center gap-2">
          <input type="hidden" name="id" value={r.id} />
          <Select name="status" defaultValue={r.status} aria-label="Lead status" className="py-1">
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <Button type="submit" size="sm" variant="subtle">
            Set
          </Button>
        </form>
      ),
    },
    { id: 'created', header: 'Created', cell: (r) => when(r.createdAt) },
  ];
  return (
    <div className="flex flex-col gap-4">
      <Title>Leads</Title>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        params={params}
        total={total}
        pageSize={PAGE}
        basePath="/admin/leads"
        search={false}
        filters={[
          { key: 'status', label: 'Status', options: LEAD_STATUSES.map((s) => ({ value: s, label: s })) },
          { key: 'source', label: 'Source', options: LEAD_SOURCES.map((s) => ({ value: s, label: s })) },
        ]}
      />
    </div>
  );
}

const SEGMENT_LABELS: Record<SegmentKey, string> = {
  first_order: 'First order',
  bulk_buyer: 'Bulk buyers',
  by_district: 'By district',
  wizard_lead_no_order: 'Planner leads without an order',
};

export async function SegmentsPage({ searchParams }: { searchParams: SearchParamsInput }) {
  const params = parseTableParams(searchParams, { filters: { segment: SEGMENT_KEYS } });
  const key = (params.filters.segment ?? 'first_order') as SegmentKey;
  const [counts, { rows, total }] = await Promise.all([segmentCounts(), segmentMembers(key, { page: params.page, pageSize: PAGE })]);
  const columns: Column<SegmentMember>[] = [
    { id: 'name', header: 'Name', cell: (r) => r.name ?? '-' },
    { id: 'phone', header: 'Phone', cell: (r) => r.phoneE164 ?? '-' },
    { id: 'detail', header: key === 'by_district' ? 'District' : key === 'wizard_lead_no_order' ? 'Lead status' : 'Orders', cell: (r) => r.detail ?? '-' },
    { id: 'created', header: 'Created', cell: (r) => when(r.createdAt) },
  ];
  return (
    <div className="flex flex-col gap-4">
      <Title>Segments</Title>
      <div className="grid gap-3 sm:grid-cols-4">
        {SEGMENT_KEYS.map((k) => (
          <Link key={k} href={`/admin/segments?segment=${k}`} aria-current={k === key ? 'page' : undefined}>
            <Stat label={SEGMENT_LABELS[k]} value={counts[k]} className={k === key ? 'ring-2 ring-primary' : undefined} />
          </Link>
        ))}
      </div>
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} params={params} total={total} pageSize={PAGE} basePath="/admin/segments" search={false} />
    </div>
  );
}

export async function ConsentPage({ searchParams }: { searchParams: SearchParamsInput }) {
  const params = parseTableParams(searchParams, { filters: { purpose: CONSENT_PURPOSES } });
  const { rows, total } = await listConsent({ purpose: params.filters.purpose as ConsentPurpose | undefined, page: params.page, pageSize: PAGE });
  const columns: Column<ConsentRow>[] = [
    { id: 'when', header: 'When', cell: (r) => when(r.createdAt) },
    { id: 'purpose', header: 'Purpose', cell: (r) => r.purpose },
    { id: 'status', header: 'Status', cell: (r) => <Badge tone={r.status === 'granted' ? 'success' : 'warning'}>{r.status}</Badge> },
    { id: 'subject', header: 'Subject', cell: (r) => (r.userId ? 'Customer account' : r.phoneHash ? 'Phone' : 'Email') },
    { id: 'source', header: 'Source', cell: (r) => r.source },
    { id: 'text', header: 'Text shown', cell: (r) => <span className="line-clamp-2 max-w-md">{r.textShown}</span> },
  ];
  return (
    <div className="flex flex-col gap-4">
      <Title>Consent log</Title>
      <p className="text-sm text-muted">Every grant and revocation, with the exact text shown. Rows are never edited; the newest row per person and purpose decides.</p>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        params={params}
        total={total}
        pageSize={PAGE}
        basePath="/admin/consent"
        search={false}
        filters={[{ key: 'purpose', label: 'Purpose', options: CONSENT_PURPOSES.map((p) => ({ value: p, label: p })) }]}
      />
    </div>
  );
}
