import { requirePermission } from '@ecomkit/core/auth-context';
import type { Paise } from '@ecomkit/core/contracts';
import { formatINR } from '@ecomkit/core/money';
import { Badge, Button, DataTable, EmptyState, Input, TBody, THead, Table, Td, Th, Tr, type Column } from '@ecomkit/ui';
import { parseTableParams } from '@ecomkit/ui/domain';
import { ATTEMPT_PROVIDERS, ATTEMPT_STATES, listAttempts, listOpenBankTransfers, listRefunds } from '../server/actions';
import type { PaymentAttemptRow } from '../schema';
import { markReceivedAction, startRefundTaskAction } from './actions';

type SearchParams = Record<string, string | string[] | undefined>;

const PAGE_SIZE = 50;
const when = (d: Date) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(d);
const money = (n: number) => formatINR(n as Paise);
const STATE_TONE = { pending: 'warning', completed: 'success', failed: 'danger', expired: 'neutral' } as const;
const REFUND_TONE = { task: 'danger', pending: 'warning', completed: 'success', failed: 'danger' } as const;
const NOTICE: Record<string, string> = {
  refund_started: 'Refund sent to the gateway.',
  received: 'Payment marked as received.',
  amount_mismatch: 'The amount differs from what was due: the order was not changed and a refund task was created.',
  late_completed: 'The order no longer awaits payment: a refund task was created.',
  not_refundable: 'That refund was already started.',
  gateway_error: 'The gateway refused the request. See the integration log.',
  forbidden: 'You do not have permission for that.',
  invalid: 'Check the values and try again.',
  not_found: 'Not found.',
  not_offline: 'Only bank transfers can be marked received.',
  not_pending: 'This transfer is already marked received.',
};

const columns: Column<PaymentAttemptRow>[] = [
  { id: 'created', header: 'Started', cell: (r) => <span className="whitespace-nowrap tabular-nums">{when(r.createdAt)}</span> },
  { id: 'ref', header: 'Payment ref', cell: (r) => <span className="font-mono text-xs">{r.merchantOrderId}</span> },
  { id: 'method', header: 'Method', cell: (r) => `${r.method.replace('_', ' ')} (${r.provider.replace('_', ' ')})` },
  { id: 'amount', header: 'Amount', align: 'right', cell: (r) => <span className="tabular-nums">{money(r.amountPaise)}</span> },
  {
    id: 'state',
    header: 'State',
    cell: (r) => (
      <span className="flex flex-wrap gap-1">
        <Badge tone={STATE_TONE[r.state]}>{r.state}</Badge>
        {r.anomaly ? <Badge tone="danger">{r.anomaly.replace('_', ' ')}</Badge> : null}
        {r.isTest ? <Badge tone="outline">test</Badge> : null}
      </span>
    ),
  },
  { id: 'window', header: 'Window ends', cell: (r) => <span className="whitespace-nowrap tabular-nums">{when(r.expiresAt)}</span> },
  { id: 'error', header: 'Note', cell: (r) => <span className="text-xs text-muted">{r.error ?? ''}</span> },
];

/** /admin/payments: attempts (URL-bound filters), refund tasks and refunds, open bank transfers. */
export async function PaymentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission('orders.read');
  const sp = await searchParams;
  const params = parseTableParams(sp, { filters: { state: ATTEMPT_STATES, provider: ATTEMPT_PROVIDERS } });
  const [{ rows, total }, refunds, transfers] = await Promise.all([
    listAttempts({ q: params.q, state: params.filters.state, provider: params.filters.provider, page: params.page, pageSize: PAGE_SIZE }),
    listRefunds(),
    listOpenBankTransfers(),
  ]);
  const msg = typeof sp.msg === 'string' ? NOTICE[sp.msg] : undefined;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Payments</h1>
      {msg ? (
        <p role="status" className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm">
          {msg}
        </p>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Refunds and refund tasks</h2>
        {refunds.length === 0 ? (
          <EmptyState title="No refunds" body="Refund tasks appear here when money arrives that an order cannot take." />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Refund ref</Th>
                <Th>Payment ref</Th>
                <Th>Amount</Th>
                <Th>State</Th>
                <Th>Reason</Th>
                <Th>Created</Th>
                <Th>Action</Th>
              </Tr>
            </THead>
            <TBody>
              {refunds.map((r) => (
                <Tr key={r.id}>
                  <Td className="font-mono text-xs">{r.merchantRefundId}</Td>
                  <Td className="font-mono text-xs">{r.merchantOrderId}</Td>
                  <Td className="tabular-nums">{money(r.amountPaise)}</Td>
                  <Td>
                    <Badge tone={REFUND_TONE[r.state]}>{r.state}</Badge>
                  </Td>
                  <Td className="text-sm">{r.reason ?? ''}</Td>
                  <Td className="whitespace-nowrap tabular-nums">{when(r.createdAt)}</Td>
                  <Td>
                    {r.state === 'task' ? (
                      <form action={startRefundTaskAction}>
                        <input type="hidden" name="refundId" value={r.id} />
                        <Button type="submit" size="sm" variant="danger" data-cta="payments-refund-task">
                          Refund now
                        </Button>
                      </form>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      {transfers.length ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Bank transfers awaiting receipt</h2>
          <Table>
            <THead>
              <Tr>
                <Th>Payment ref</Th>
                <Th>Due</Th>
                <Th>Hold ends</Th>
                <Th>Received amount (Rs)</Th>
              </Tr>
            </THead>
            <TBody>
              {transfers.map((t) => (
                <Tr key={t.id}>
                  <Td className="font-mono text-xs">{t.merchantOrderId}</Td>
                  <Td className="tabular-nums">{money(t.amountPaise)}</Td>
                  <Td className="whitespace-nowrap tabular-nums">{when(t.expiresAt)}</Td>
                  <Td>
                    <form action={markReceivedAction} className="flex items-center gap-2">
                      <input type="hidden" name="attemptId" value={t.id} />
                      <Input name="amountRupees" inputMode="decimal" defaultValue={(t.amountPaise / 100).toFixed(2)} aria-label="Received amount in rupees" className="w-32" />
                      <Button type="submit" size="sm" data-cta="payments-mark-received">
                        Mark received
                      </Button>
                    </form>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Payment attempts</h2>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          params={params}
          total={total}
          pageSize={PAGE_SIZE}
          basePath="/admin/payments"
          filters={[
            { key: 'state', label: 'State', options: ATTEMPT_STATES.map((v) => ({ value: v, label: v })) },
            { key: 'provider', label: 'Gateway', options: ATTEMPT_PROVIDERS.map((v) => ({ value: v, label: v.replace('_', ' ') })) },
          ]}
          empty={<EmptyState title="No payment attempts yet" />}
        />
      </section>
    </div>
  );
}
