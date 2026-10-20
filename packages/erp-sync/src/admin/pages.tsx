// Admin UI (English only, exempt from the messages rule): sync log page, mapping panel on the settings page,
// dashboard tile, drift report.
import { Badge, Button, buttonVariants, EmptyState, Input, Stat, Table, TBody, Td, Th, THead, Tr } from '@ecomkit/ui';
import Link from 'next/link';
import { driftReport, listOutbox, listRuns, mappingOverview, outboxCounts, variantCandidates, type OutboxRow } from '../server';
import { mapItemAction, retryOutboxAction, unmapItemAction } from './actions';

const ist = (d: Date | null | undefined) => (d ? d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '-');

const STATUS_TONE: Record<OutboxRow['status'], 'neutral' | 'success' | 'warning' | 'danger'> = { pending: 'neutral', sent: 'success', failed: 'warning', dead: 'danger' };

/** /admin/erp: counts, recent runs, outbox rows not yet sent (retry, CSV for the manual bridge). */
export async function ErpSyncPage() {
  const [counts, runs, outbox] = await Promise.all([outboxCounts(), listRuns(30), listOutbox({ limit: 200 })]);
  const lastPull = runs.find((r) => r.direction === 'inventory_in');
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-text">ERP sync</h1>
        <div className="flex gap-2">
          <Link className={buttonVariants({ variant: 'subtle', size: 'sm' })} href="/api/admin/erp/pending-orders" prefetch={false} data-cta="erp-pending-csv">
            Download pending orders (CSV)
          </Link>
          <Link className={buttonVariants({ variant: 'outline', size: 'sm' })} href="/admin/settings/erp-sync" data-cta="erp-settings">
            Settings and mapping
          </Link>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Orders waiting for ERP" value={counts.waitingOrders} />
        <Stat label="Leads waiting for ERP" value={counts.waitingLeads} />
        <Stat label="Dead letter" value={counts.dead} />
      </div>
      <p className="text-sm text-muted">Last stock pull: {lastPull ? `${ist(lastPull.startedAt)}, ${lastPull.items} items, ${lastPull.changed} changed${lastPull.errors ? ', failed' : ''}` : 'never'}</p>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-text">Outbox</h2>
        {outbox.length === 0 ? (
          <EmptyState title="Nothing waiting" body="Every paid order and lead has reached the ERP." />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Kind</Th>
                <Th>Reference</Th>
                <Th>Status</Th>
                <Th className="text-right">Attempts</Th>
                <Th>Next try</Th>
                <Th>Last error</Th>
                <Th />
              </Tr>
            </THead>
            <TBody>
              {outbox.map((r) => (
                <Tr key={r.id}>
                  <Td>{r.kind}</Td>
                  <Td className="font-mono text-xs">{(r.payload as { ecomOrderNumber?: string } | null)?.ecomOrderNumber ?? r.refId}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                  </Td>
                  <Td className="text-right">{r.attempts}</Td>
                  <Td>{r.status === 'dead' ? '-' : ist(r.nextAttemptAt)}</Td>
                  <Td className="max-w-80 truncate text-xs text-muted" title={r.lastError ?? undefined}>
                    {r.lastError ?? '-'}
                  </Td>
                  <Td>
                    {(r.status === 'dead' || r.status === 'failed') && (
                      <form action={retryOutboxAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <Button size="sm" variant="subtle" type="submit" data-cta="erp-retry">
                          Retry
                        </Button>
                      </form>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-text">Sync log</h2>
        {runs.length === 0 ? (
          <EmptyState title="No runs yet" body="Runs appear after the first stock pull or order push." />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Started</Th>
                <Th>Direction</Th>
                <Th>Transport</Th>
                <Th className="text-right">Items</Th>
                <Th className="text-right">Changed</Th>
                <Th>Result</Th>
              </Tr>
            </THead>
            <TBody>
              {runs.map((r) => (
                <Tr key={r.id}>
                  <Td>{ist(r.startedAt)}</Td>
                  <Td>{r.direction === 'inventory_in' ? 'Stock in' : 'Orders and leads out'}</Td>
                  <Td>{r.transport}</Td>
                  <Td className="text-right">{r.items}</Td>
                  <Td className="text-right">{r.changed}</Td>
                  <Td>
                    {!r.finishedAt ? (
                      <Badge tone="neutral">running</Badge>
                    ) : r.errors ? (
                      <Badge tone="danger" title={String((r.log as { error?: string }).error ?? '')}>
                        {r.direction === 'inventory_in' ? 'failed' : `${r.errors} failed`}
                      </Badge>
                    ) : (
                      <Badge tone="success">ok</Badge>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>
    </div>
  );
}

/** Settings custom panel: unmapped ERP items with the best suggestion, and the current links. */
export async function MappingPanel() {
  const [overview, candidates] = await Promise.all([mappingOverview(), variantCandidates()]);
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-text">Item mapping</h2>
      <p className="text-sm text-muted">
        Stock only flows for variants linked to an ERP item. Matches scoring at or above the threshold link themselves; link the rest here by variant SKU or id.
      </p>
      <datalist id="erp-variant-options">
        {candidates.map((c) => (
          <option key={c.variantId} value={c.sku ?? c.variantId}>
            {[c.name, c.variety].filter(Boolean).join(' ')}
          </option>
        ))}
      </datalist>
      <h3 className="font-semibold text-text">{`Unmapped ERP items (${overview.unmapped.length})`}</h3>
      {overview.unmapped.length === 0 ? (
        <EmptyState title="All ERP items are linked" body="New items from the ERP show up here after the next pull." />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>ERP item</Th>
              <Th className="text-right">ERP stock</Th>
              <Th>Suggestion</Th>
              <Th>Link to variant</Th>
            </Tr>
          </THead>
          <TBody>
            {overview.unmapped.map((u) => (
              <Tr key={u.erpItemId}>
                <Td>
                  {u.name}
                  {u.variety ? <span className="text-muted"> {u.variety}</span> : null}
                </Td>
                <Td className="text-right">{u.available}</Td>
                <Td className="text-sm">{u.suggestion ? `${u.suggestion.label} (${Math.round(u.suggestion.confidence * 100)}%)` : '-'}</Td>
                <Td>
                  <form action={mapItemAction} className="flex gap-2">
                    <input type="hidden" name="erpItemId" value={u.erpItemId} />
                    <Input name="variant" list="erp-variant-options" required aria-label="Variant SKU or id" defaultValue={u.suggestion ? (candidates.find((c) => c.variantId === u.suggestion!.variantId)?.sku ?? u.suggestion.variantId) : ''} className="h-9 w-56" />
                    <Button size="sm" type="submit" data-cta="erp-map">
                      Link
                    </Button>
                  </form>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
      <h3 className="font-semibold text-text">{`Linked (${overview.mapped.length})`}</h3>
      {overview.mapped.length > 0 && (
        <Table>
          <THead>
            <Tr>
              <Th>ERP item</Th>
              <Th>Variant</Th>
              <Th>How</Th>
              <Th className="text-right">Confidence</Th>
              <Th />
            </Tr>
          </THead>
          <TBody>
            {overview.mapped.map((m) => (
              <Tr key={m.variantId}>
                <Td>{m.erpName ?? m.erpItemId}</Td>
                <Td className="font-mono text-xs">{candidates.find((c) => c.variantId === m.variantId)?.sku ?? m.variantId}</Td>
                <Td>
                  <Badge tone={m.mappedBy === 'manual' ? 'neutral' : 'outline'}>{m.mappedBy}</Badge>
                </Td>
                <Td className="text-right">{`${Math.round(m.confidence * 100)}%`}</Td>
                <Td>
                  <form action={unmapItemAction}>
                    <input type="hidden" name="variantId" value={m.variantId} />
                    <Button size="sm" variant="ghost" type="submit" data-cta="erp-unmap">
                      Unlink
                    </Button>
                  </form>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </section>
  );
}

/** Dashboard tile: orders waiting for the ERP (the manual bridge while the ops endpoint does not exist). */
export async function WaitingOrdersTile() {
  const c = await outboxCounts();
  return (
    <Link href="/admin/erp" className="block" data-cta="erp-waiting-tile">
      <Stat label="Orders waiting for ops sync" value={c.waitingOrders} delta={c.dead ? `${c.dead} in dead letter` : undefined} trend={c.dead ? 'down' : 'flat'} />
    </Link>
  );
}

/** Analytics report: stock drift between this store and the ERP. */
export async function DriftReportView() {
  const rows = await driftReport();
  if (!rows.length) return <EmptyState title="No drift" body="Every linked variant matches what the ERP last reported." />;
  return (
    <Table>
      <THead>
        <Tr>
          <Th>Variant</Th>
          <Th>ERP item</Th>
          <Th className="text-right">Ours</Th>
          <Th className="text-right">ERP</Th>
          <Th className="text-right">Difference</Th>
          <Th>Source</Th>
        </Tr>
      </THead>
      <TBody>
        {rows.map((r) => (
          <Tr key={r.variantId} className={r.manualOverride ? 'bg-warning/10' : undefined}>
            <Td className="font-mono text-xs">{r.sku ?? r.variantId}</Td>
            <Td>{r.erpName ?? r.erpItemId}</Td>
            <Td className="text-right">{r.ourOnHand ?? '-'}</Td>
            <Td className="text-right">{r.erpAvailable}</Td>
            <Td className="text-right">{r.diff ?? '-'}</Td>
            <Td>{r.manualOverride ? <Badge tone="warning">manual override</Badge> : <Badge tone="outline">erp</Badge>}</Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}
