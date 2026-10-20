import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatINR } from '@ecomkit/core/money';
import { can, requirePermission } from '@ecomkit/core/auth-context';
import { Badge, Button, Checkbox, DataTable, EmptyState, FormField, Input, Select, Stat, TBody, THead, Table, Td, Th, Tr, type Column } from '@ecomkit/ui';
import { parseTableParams } from '@ecomkit/ui/domain';
import { FLOW_CHANNELS, FLOW_DEFS, isFlowKey, isMarketingTemplate } from '../domain';
import { ABANDONED_VIEWS, getFlowDetail, listAbandonedCheckouts, listFlowCards, type AbandonedRow, type AbandonedView } from '../server/admin';
import type { RunRow } from '../server/runner';
import { saveFlowAction, stopRemindersAction, testRunAction } from './actions';

const IST = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const when = (d: Date | null) => (d ? IST.format(d) : '');
const hours = (minutes: number) => (minutes % 60 === 0 ? String(minutes / 60) : (minutes / 60).toFixed(2));
const CHANNEL_LABEL = { whatsapp: 'WhatsApp', email: 'Email', both: 'WhatsApp and email' } as const;
const STOP_LABEL: Record<string, string> = {
  no_contact: 'No contact',
  no_consent: 'No marketing consent',
  frequency_cap: '7-day cap',
  subject_missing: 'Source unavailable',
  order_cancelled: 'Order cancelled',
  purchased: 'Purchased',
  replied: 'Replied',
  unsubscribed: 'Unsubscribed',
  stopped_by_staff: 'Stopped by staff',
};

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function RunStatus({ run }: { run: RunRow }) {
  const label = run.status === 'stopped' ? (STOP_LABEL[run.stopReason ?? ''] ?? run.stopReason) : run.status === 'failed' ? 'Failed' : run.status === 'running' ? 'Running' : 'Completed';
  return (
    <span className="flex flex-col">
      <Badge>{label}</Badge>
      {run.status === 'failed' && run.stopReason ? <span className="text-xs text-danger">{run.stopReason}</span> : null}
    </span>
  );
}

/** /admin/marketing/automations: one card per fixed flow. */
export async function AutomationsPage() {
  const cards = await listFlowCards();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Automations</h1>
      <p className="text-sm text-muted">Fixed message flows. Each has one settings form, a run list and a test send. Counts are for the last 30 days.</p>
      <div className="grid gap-4 md:grid-cols-2">
        {cards.map(({ flow, description, last30 }) => (
          <Link
            key={flow.key}
            href={`/admin/marketing/automations/${flow.key}`}
            data-cta={`automation-${flow.key}`}
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 hover:border-primary"
          >
            <span className="flex items-center justify-between gap-2">
              <span className="font-semibold">{flow.name}</span>
              <Badge>{flow.status === 'active' ? 'On' : 'Paused'}</Badge>
            </span>
            <span className="text-sm text-muted">{description}</span>
            <span className="text-xs text-muted">
              {last30.started} runs, {last30.messaged} messaged, {last30.messages} messages, {last30.stopped} stopped
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** /admin/marketing/automations/[key]: settings form, test send, run list. */
export async function FlowPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Search }) {
  const { key } = await params;
  if (!isFlowKey(key)) notFound();
  const { flow, runs } = await getFlowDetail(key);
  const sp = await searchParams;
  const def = FLOW_DEFS[key];
  const s = flow.settings;
  const error = one(sp.error);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/admin/marketing/automations" className="text-sm text-muted hover:underline">
          Automations
        </Link>
        <h1 className="text-2xl font-semibold">{flow.name}</h1>
        <p className="text-sm text-muted">{def.description}</p>
      </div>
      {error ? <p className="rounded-md border border-danger p-3 text-sm text-danger">{error}</p> : null}
      {one(sp.saved) ? <p className="rounded-md border border-success p-3 text-sm">Saved (version {flow.version}).</p> : null}
      {one(sp.tested) ? <p className="rounded-md border border-success p-3 text-sm">Test sent: {one(sp.tested)} message(s) queued. See the message log.</p> : null}

      <form action={saveFlowAction} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
        <input type="hidden" name="key" value={key} />
        <label className="flex items-center gap-2 font-medium">
          <Checkbox name="enabled" defaultChecked={flow.status === 'active'} /> Flow is on
        </label>
        {s.steps.map((st, i) => (
          <fieldset key={i} className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-4">
            <legend className="px-1 text-sm font-semibold">
              Step {i + 1}
              {isMarketingTemplate(st.templateKey) ? ' (marketing)' : ' (utility)'}
              {def.offerStep === i ? ', may carry the single-use code' : ''}
            </legend>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox name={`step${i}_enabled`} defaultChecked={st.enabled} /> Send this step
            </label>
            <FormField id={`step${i}_delay`} label="Hours after start">
              {(c) => <Input {...c} name={`step${i}_delay_hours`} type="number" min={0} step="0.25" defaultValue={hours(st.delayMinutes)} disabled={key === 'back_in_stock'} />}
            </FormField>
            <FormField id={`step${i}_channel_f`} label="Channel">
              {(c) => (
                <Select {...c} name={`step${i}_channel`} defaultValue={st.channel}>
                  {FLOW_CHANNELS.map((ch) => (
                    <option key={ch} value={ch}>
                      {CHANNEL_LABEL[ch]}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField id={`step${i}_template_f`} label="Template">
              {(c) => (
                <Select {...c} name={`step${i}_template`} defaultValue={st.templateKey}>
                  {def.templates[i]!.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            {key === 'back_in_stock' ? <input type="hidden" name={`step${i}_delay_hours`} value="0" /> : null}
          </fieldset>
        ))}
        <div className="grid gap-3 md:grid-cols-2">
          <FormField id="quietHours" label="Quiet hours (IST)" help="Windows like 09:00-11:00, separated by commas. A message due inside one waits until it ends. Night hours for marketing are also held by the message settings.">
            {(c) => <Input {...c} name="quietHours" defaultValue={s.quietHours.join(', ')} />}
          </FormField>
          <FormField id="maxPer7Days" label="Sequences per contact per 7 days" help="0 means no limit.">
            {(c) => <Input {...c} name="maxPer7Days" type="number" min={0} max={10} defaultValue={s.maxPer7Days} />}
          </FormField>
          {def.offerStep !== null ? (
            <>
              <FormField id="discountRuleId" label="Discount rule for the single-use code" help="Id of a code-type discount rule (Discounts). Leave empty to send no code. One code per run, bound to the phone, applied by the cart link.">
                {(c) => <Input {...c} name="discountRuleId" defaultValue={s.discountRuleId ?? ''} />}
              </FormField>
              <FormField id="codeValidHours" label="Code valid for (hours)">
                {(c) => <Input {...c} name="codeValidHours" type="number" min={1} max={168} defaultValue={s.codeValidHours} />}
              </FormField>
            </>
          ) : (
            <input type="hidden" name="codeValidHours" value={s.codeValidHours} />
          )}
        </div>
        <div>
          <Button type="submit" data-cta="automation-save">
            Save
          </Button>
        </div>
      </form>

      <form action={testRunAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-4">
        <input type="hidden" name="key" value={key} />
        <FormField id="test-phone" label="Test to phone">
          {(c) => <Input {...c} name="phone" inputMode="tel" placeholder="+91" />}
        </FormField>
        <FormField id="test-email" label="Test to email">
          {(c) => <Input {...c} name="email" type="email" />}
        </FormField>
        <Button type="submit" variant="outline" data-cta="automation-test">
          Send test
        </Button>
      </form>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Recent runs</h2>
        {runs.length === 0 ? (
          <EmptyState title="No runs yet" body="Runs appear here when this flow's trigger happens." />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Started (IST)</Th>
                <Th>Subject</Th>
                <Th>Status</Th>
                <Th>Messages</Th>
                <Th>Next step</Th>
              </Tr>
            </THead>
            <TBody>
              {runs.map((r) => (
                <Tr key={r.id}>
                  <Td className="whitespace-nowrap">{when(r.startedAt)}</Td>
                  <Td>
                    {r.subjectType}
                    {r.isTest ? ' (test)' : ''}
                  </Td>
                  <Td>
                    <RunStatus run={r} />
                  </Td>
                  <Td>{r.messages}</Td>
                  <Td className="whitespace-nowrap">{when(r.nextStepAt)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>
    </div>
  );
}

const ABANDONED_LABEL: Record<AbandonedView, string> = { running: 'Reminding', recovered: 'Recovered', completed: 'Not recovered', stopped: 'Stopped' };
const PAGE = 50;

/** /admin/abandoned-checkouts (Shopify index): 30-day stats, saved views by outcome, row checkboxes to stop reminders. No contact data is shown. */
export async function AbandonedCheckoutsPage({ searchParams }: { searchParams: Search }) {
  const viewer = await requirePermission('orders.read');
  const params = parseTableParams(await searchParams, { filters: { view: ABANDONED_VIEWS } });
  const { rows, total, last30 } = await listAbandonedCheckouts({ view: params.filters.view as AbandonedView | undefined, page: params.page, pageSize: PAGE });
  const columns: Column<AbandonedRow>[] = [
    { id: 'when', header: 'Abandoned (IST)', className: 'whitespace-nowrap', cell: ({ run }) => when(run.startedAt) },
    { id: 'value', header: 'Cart value', align: 'right', cell: ({ valuePaise }) => (valuePaise === null ? '' : formatINR(valuePaise)) },
    { id: 'items', header: 'Items', align: 'right', cell: ({ itemCount }) => itemCount ?? '' },
    { id: 'sent', header: 'Reminders sent', align: 'right', cell: ({ run }) => run.messages },
    { id: 'outcome', header: 'Outcome', cell: ({ run }) => <RunStatus run={run} /> },
    { id: 'next', header: 'Next reminder', className: 'whitespace-nowrap', cell: ({ run }) => when(run.nextStepAt) },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Abandoned checkouts</h1>
        <Link href="/admin/marketing/automations/abandoned_cart" className="text-sm text-primary hover:underline" data-cta="abandoned-settings">
          Reminder settings
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Abandoned (30 days)" value={String(last30.started)} />
        <Stat label="Reminded" value={String(last30.messaged)} />
        <Stat label="Recovered after a reminder" value={String(last30.recovered)} />
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={({ run }) => run.id}
        params={params}
        total={total}
        pageSize={PAGE}
        basePath="/admin/abandoned-checkouts"
        search={false}
        views={ABANDONED_VIEWS.map((v) => ({ id: v, label: ABANDONED_LABEL[v], filters: { view: v } }))}
        bulkActions={can(viewer, 'marketing.write') ? [{ label: 'Stop reminders', action: stopRemindersAction, tone: 'danger' }] : undefined}
        empty={<EmptyState title="No abandoned checkouts" body="Carts left with a known contact appear here." />}
      />
    </div>
  );
}
