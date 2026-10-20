// Pure rules for the hasiru-ops adapter: settings, the read-only column allowlist and its SQL, request signing,
// row and lead mapping. No DB, no network.
import type { ErpInventoryItem, ErpLeadPayload, Paise } from '@ecomkit/core/contracts';
import { z } from 'zod';

const secret = (group: string, help: string) => z.string().max(4000).optional().meta({ secret: true, group, help });
const httpsUrl = z.union([z.literal(''), z.url({ protocol: /^https$/ })]).default('');

export const TRANSPORTS = ['mock', 'pg', 'ops-api'] as const;
export type Transport = (typeof TRANSPORTS)[number];

export const opsSettingsSchema = z.object({
  transport: z.enum(TRANSPORTS).default('mock').meta({
    group: 'Connection',
    help: 'Mock answers locally. pg reads stock through the read-only ecom_sync database role. ops-api uses the signed endpoints once the operations team ships them. Orders and leads always go out over HTTPS.',
  }),
  pgUrl: secret('Connection', 'Postgres connection string for the read-only ecom_sync role (TLS required). Never the service-role key.'),
  opsBaseUrl: httpsUrl.meta({ group: 'Connection', help: 'Base URL of the operations app, e.g. https://ops.example.com. Orders out and the ops-api stock feed use it.', placeholder: 'https://' }),
  opsHmacSecret: secret('Connection', 'Shared secret for signed requests both ways (orders out, status callbacks in).'),
  leadsIntakeUrl: httpsUrl.meta({ group: 'Leads', help: 'Full URL of the operations lead intake endpoint.', placeholder: 'https://…/api/leads/intake' }),
  leadsIntakeSecret: secret('Leads', 'Value of the x-intake-secret header the operations app expects.'),
});
export type OpsSettings = z.infer<typeof opsSettingsSchema>;

// ---- read-only Postgres transport ----

/**
 * The only columns the pg transport reads. The GRANT script in docs/hasiru-ops-sync-spec.md is generated from these
 * (`grantScript`), so the role cannot see anything else even if the query changed.
 */
export const PG_ALLOWLIST = {
  items: ['id', 'name', 'variety', 'size_grade', 'cost_rate', 'is_active', 'track_stock'],
  stock_batches: ['item_id', 'qty_available', 'status', 'expected_ready'],
} as const;

type Table = keyof typeof PG_ALLOWLIST;
function col<T extends Table>(alias: string, table: T, name: (typeof PG_ALLOWLIST)[T][number]): string {
  if (!(PG_ALLOWLIST[table] as readonly string[]).includes(name)) throw new Error(`column ${table}.${name} is not allowlisted`);
  return `${alias}.${name}`;
}

/**
 * One keyset page of items with ready stock summed over batches and the earliest expected-ready date of growing
 * batches. $1 = last item id of the previous page (or null), $2 = page size.
 */
export const PG_INVENTORY_SQL = `select ${col('i', 'items', 'id')}::text as id, ${col('i', 'items', 'name')} as name, ${col('i', 'items', 'variety')} as variety,
  ${col('i', 'items', 'size_grade')} as size_grade, ${col('i', 'items', 'cost_rate')}::text as cost_rate,
  coalesce(sum(${col('b', 'stock_batches', 'qty_available')}) filter (where ${col('b', 'stock_batches', 'status')} = 'ready'), 0)::text as available,
  (min(${col('b', 'stock_batches', 'expected_ready')}) filter (where ${col('b', 'stock_batches', 'status')} = 'growing' and ${col('b', 'stock_batches', 'qty_available')} > 0))::text as expected_ready
from items i left join stock_batches b on ${col('b', 'stock_batches', 'item_id')} = ${col('i', 'items', 'id')}
where ${col('i', 'items', 'is_active')} and ${col('i', 'items', 'track_stock')} and ($1::uuid is null or ${col('i', 'items', 'id')} > $1::uuid)
group by ${col('i', 'items', 'id')}
order by ${col('i', 'items', 'id')}
limit $2`;

/**
 * SQL the operations team runs once on their database (password set by them, shared out of band). Both tables have
 * row level security on (staff-only policies), so the role also gets a read-only policy; it never gets BYPASSRLS.
 */
export function grantScript(role = 'ecom_sync'): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error('invalid role name');
  return [
    `create role ${role} login password '<set-by-ops-team>' nosuperuser nocreatedb nocreaterole noinherit;`,
    `alter role ${role} set default_transaction_read_only = on;`,
    `alter role ${role} set statement_timeout = '10s';`,
    `grant usage on schema public to ${role};`,
    ...Object.entries(PG_ALLOWLIST).flatMap(([table, cols]) => [
      `grant select (${cols.join(', ')}) on public.${table} to ${role};`,
      `create policy ${role}_read on public.${table} for select to ${role} using (true);`,
    ]),
  ].join('\n');
}

export interface PgInventoryRow {
  id: string;
  name: string;
  variety: string | null;
  size_grade: string | null;
  cost_rate: string | null;
  available: string;
  expected_ready: string | null;
}

/** Days from `todayIso` (yyyy-mm-dd, IST) to `dateIso`, floored at 0. */
export function daysUntil(dateIso: string | null, todayIso: string): number | null {
  if (!dateIso) return null;
  const diff = (Date.parse(`${dateIso.slice(0, 10)}T00:00:00Z`) - Date.parse(`${todayIso}T00:00:00Z`)) / 86_400_000;
  return Number.isFinite(diff) ? Math.max(0, Math.round(diff)) : null;
}

export function istDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Reads only the allowlisted aliases; size grade is part of the item, so it joins the variety for matching. */
export function pgRowToItem(row: PgInventoryRow, now: Date): ErpInventoryItem {
  const available = Math.max(0, Math.floor(Number(row.available) || 0));
  return {
    erpItemId: row.id,
    sku: null,
    name: row.name,
    variety: [row.variety, row.size_grade].filter((s) => s && s.trim()).join(' ') || null,
    available,
    readyInDays: available > 0 ? null : daysUntil(row.expected_ready, istDate(now)),
    costPaise: row.cost_rate == null ? null : (Math.round(Number(row.cost_rate) * 100) as Paise),
    updatedAt: now.toISOString(),
  };
}

// ---- signed HTTP (ops-api both ways) ----

export const SIGNATURE_MAX_SKEW_SEC = 300;
export const SIGNED_HEADERS = { timestamp: 'x-timestamp', nonce: 'x-nonce', signature: 'x-signature' } as const;

/** What gets signed: unix seconds, nonce, upper-case method, path with query, raw body, joined by newlines. */
export function signingString(input: { timestamp: string; nonce: string; method: string; path: string; body: string }): string {
  return [input.timestamp, input.nonce, input.method.toUpperCase(), input.path, input.body].join('\n');
}

export const NONCE_RE = /^[A-Za-z0-9_-]{16,128}$/;

// ---- lead intake ----

/** Body for the existing POST /api/leads/intake (create only: name, phone, email, message, source, lead_type). */
export function toIntakeBody(lead: ErpLeadPayload): Record<string, string | null> {
  const message = [
    lead.purpose,
    lead.landAcres != null ? `Land: ${lead.landAcres} acres` : null,
    lead.district ? `District: ${lead.district}` : null,
    lead.notes,
    `Store lead ${lead.leadId}`,
  ]
    .filter(Boolean)
    .join('. ');
  return {
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    message: message.slice(0, 2000),
    source: `ecom-${lead.source.replace('_', '-')}`,
    lead_type: lead.source === 'enquiry' ? 'service' : 'nursery',
  };
}
