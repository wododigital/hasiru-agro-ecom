import { can, getViewer } from '@ecomkit/core/auth-context';
import { Badge, Button, Checkbox, DataTable, Input, Select, TBody, THead, Table, Td, Th, Tr, type Column } from '@ecomkit/ui';
import { parseTableParams, type SearchParamsInput } from '@ecomkit/ui/domain';
import { ALERT_CHANNELS, SEVERITIES, type AlertStatus, type Severity } from '../domain';
import { listAlerts, listRules, type AlertRow } from '../server/alerts';
import { ackAlertAction, resolveAlertAction, updateRuleAction } from './actions';
import { ago, ist, severityTone } from './format';
import { HealthTabs } from './HealthTabs';

const PAGE_SIZE = 50;
const SPEC = { filters: { status: ['unresolved', 'open', 'acked', 'resolved'], severity: [...SEVERITIES] } } as const;

const columns = (now: Date): Column<AlertRow>[] => [
  { id: 'severity', header: 'Severity', cell: (a) => <Badge tone={severityTone[a.severity]}>{a.severity}</Badge> },
  {
    id: 'title',
    header: 'Alert',
    cell: (a) => (
      <div className="flex flex-col gap-0.5">
        <span className="font-medium text-text">{a.title}</span>
        {a.body ? <span className="line-clamp-2 text-xs text-muted">{a.body}</span> : null}
        <span className="font-mono text-[11px] text-muted">{a.ruleKey}</span>
      </div>
    ),
  },
  { id: 'count', header: 'Count', align: 'right', cell: (a) => <span className="tabular-nums">{a.count}</span> },
  { id: 'status', header: 'Status', cell: (a) => <Badge tone={a.status === 'open' ? 'danger' : a.status === 'acked' ? 'warning' : 'success'}>{a.status}</Badge> },
  {
    id: 'last',
    header: 'Last seen',
    cell: (a) => (
      <span title={`First ${ist(a.firstAt)}, last ${ist(a.lastAt)}`}>
        {ago(a.lastAt, now)}
        {a.notifiedAt ? <span className="block text-xs text-muted">notified {ago(a.notifiedAt, now)}</span> : <span className="block text-xs text-muted">bell only</span>}
      </span>
    ),
  },
  {
    id: 'actions',
    header: <span className="sr-only">Actions</span>,
    cell: (a) =>
      a.status === 'resolved' ? null : (
        <div className="flex gap-2">
          {a.status === 'open' ? (
            <form action={ackAlertAction}>
              <input type="hidden" name="id" value={a.id} />
              <Button type="submit" size="sm" variant="subtle" data-cta="alert-ack">
                Ack
              </Button>
            </form>
          ) : null}
          <form action={resolveAlertAction}>
            <input type="hidden" name="id" value={a.id} />
            <Button type="submit" size="sm" variant="ghost" data-cta="alert-resolve">
              Resolve
            </Button>
          </form>
        </div>
      ),
  },
];

/** Alert issues (URL-bound filters) and the routing rules. */
export async function AlertsPage({ searchParams, now = new Date() }: { searchParams: SearchParamsInput; now?: Date }) {
  const params = parseTableParams(searchParams, SPEC);
  const status = (params.filters.status ?? 'unresolved') as AlertStatus | 'unresolved';
  const [{ rows, total }, rules, viewer] = await Promise.all([
    listAlerts({ status, severity: params.filters.severity as Severity | undefined, page: params.page, pageSize: PAGE_SIZE }),
    listRules(),
    getViewer(),
  ]);
  const canEditRules = can(viewer, 'settings.write');

  return (
    <div className="flex flex-col gap-6">
      <HealthTabs active="/admin/health/alerts" title="Alerts" />
      <p className="max-w-3xl text-sm text-muted">
        Critical alerts go out at once by WhatsApp and email and repeat every 30 minutes until acked. High alerts go out once, then in an hourly digest. Low alerts wait for the 09:00 digest.
        When email and WhatsApp cannot deliver, the fallback webhook carries the alert. Every alert also shows here.
      </p>
      <DataTable
        columns={columns(now)}
        rows={rows}
        rowKey={(a) => a.id}
        params={params}
        total={total}
        pageSize={PAGE_SIZE}
        basePath="/admin/health/alerts"
        search={false}
        filters={[
          { key: 'status', label: 'Status', options: SPEC.filters.status.map((s) => ({ value: s, label: s })) },
          { key: 'severity', label: 'Severity', options: SEVERITIES.map((s) => ({ value: s, label: s })) },
        ]}
      />

      <section aria-labelledby="rules-h" className="flex flex-col gap-3">
        <h2 id="rules-h" className="text-lg font-semibold text-text">
          Rules
        </h2>
        <Table>
          <THead>
            <tr>
              <Th>Rule</Th>
              <Th>Severity</Th>
              <Th>Channels</Th>
              <Th>Dedupe (min)</Th>
              <Th>Repeat (min)</Th>
              <Th>Active</Th>
              <Th>
                <span className="sr-only">Save</span>
              </Th>
            </tr>
          </THead>
          <TBody>
            {rules.map((r) => {
              const formId = `rule-${r.key}`;
              return (
                <Tr key={r.key}>
                  <Td className="font-mono text-xs">
                    {r.key}
                    <form id={formId} action={updateRuleAction}>
                      <input type="hidden" name="key" value={r.key} />
                    </form>
                  </Td>
                  <Td>
                    <Select form={formId} name="severity" defaultValue={r.severity} disabled={!canEditRules} aria-label={`Severity for ${r.key}`} className="h-9 w-28">
                      {SEVERITIES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </Select>
                  </Td>
                  <Td>
                    <div className="flex gap-3">
                      {ALERT_CHANNELS.map((c) => (
                        <label key={c} className="flex items-center gap-1 text-xs">
                          <Checkbox form={formId} name="channels" value={c} defaultChecked={r.channels.includes(c)} disabled={!canEditRules} />
                          {c}
                        </label>
                      ))}
                    </div>
                  </Td>
                  <Td>
                    <Input form={formId} name="dedupeMinutes" type="number" min={1} max={10080} defaultValue={r.dedupeMinutes} disabled={!canEditRules} aria-label={`Dedupe minutes for ${r.key}`} className="h-9 w-24" />
                  </Td>
                  <Td>
                    <Input form={formId} name="repeatMinutes" type="number" min={5} max={1440} defaultValue={r.repeatMinutes ?? ''} disabled={!canEditRules} aria-label={`Repeat minutes for ${r.key}`} className="h-9 w-24" />
                  </Td>
                  <Td>
                    <Checkbox form={formId} name="isActive" defaultChecked={r.isActive} disabled={!canEditRules} aria-label={`${r.key} active`} />
                  </Td>
                  <Td>
                    {canEditRules ? (
                      <Button form={formId} type="submit" size="sm" variant="subtle" data-cta="alert-rule-save">
                        Save
                      </Button>
                    ) : null}
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      </section>
    </div>
  );
}
