import { requirePermission } from '@ecomkit/core/auth-context';
import { Badge, Button, DataTable, EmptyState, Input, Textarea, type Column } from '@ecomkit/ui';
import { parseTableParams, type SearchParamsInput } from '@ecomkit/ui/domain';
import { notFound } from 'next/navigation';
import { DEFAULT_TEMPLATES, templateVariables, STORE_NAME_VAR } from '../domain/templates';
import { whatsappConfig } from '../server/channels';
import { loadSettings, publicOrigin } from '../server/config';
import { gmailStatus } from '../server/gmail-oauth';
import { listMessages, MESSAGE_FILTERS, outboxMessages, type MessageRow } from '../server/queries';
import { listTemplates } from '../server/templates';
import { mockInboundAction, resetTemplateAction, saveTemplateAction } from './actions';

const IST = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
const TONE = { queued: 'neutral', sent: 'primary', delivered: 'success', read: 'success', failed: 'danger', skipped: 'warning' } as const;
const PAGE_SIZE = 50;

type Rendered = { subject?: string | null; text?: string; whatsapp?: { templateName?: string; category?: string } | null } | null;

/** /admin/messages: the send log (masked recipients), filterable by channel and status. */
export async function MessagesPage({ searchParams }: { searchParams: SearchParamsInput }) {
  await requirePermission('settings.read');
  const params = parseTableParams(searchParams, { filters: MESSAGE_FILTERS, sorts: ['queued', 'template'], defaultSort: { id: 'queued', dir: 'desc' } });
  const { rows, total } = await listMessages(params, PAGE_SIZE);
  const columns: Column<MessageRow>[] = [
    { id: 'queued', header: 'Queued', sortable: true, cell: (r) => IST.format(r.queuedAt) },
    { id: 'template', header: 'Template', sortable: true, cell: (r) => <code>{r.templateKey}</code> },
    { id: 'channel', header: 'Channel', cell: (r) => r.channel },
    { id: 'to', header: 'To', cell: (r) => r.toMasked },
    { id: 'status', header: 'Status', cell: (r) => <Badge tone={TONE[r.status]}>{r.status}</Badge> },
    { id: 'error', header: 'Detail', cell: (r) => (r.errorCode ? `${r.errorCode}: ` : '') + (r.error ?? '') },
  ];
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl">Message log</h1>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        params={params}
        total={total}
        pageSize={PAGE_SIZE}
        basePath="/admin/messages"
        filters={[
          { key: 'channel', label: 'Channel', options: MESSAGE_FILTERS.channel.map((v) => ({ value: v, label: v })) },
          { key: 'status', label: 'Status', options: MESSAGE_FILTERS.status.map((v) => ({ value: v, label: v })) },
        ]}
        empty={<EmptyState title="No messages yet" body="Messages appear here when the store sends an email or WhatsApp message." />}
      />
    </div>
  );
}

/** /admin/templates: every template key on every channel, with an override form. */
export async function TemplatesPage({ searchParams }: { searchParams: SearchParamsInput }) {
  await requirePermission('settings.read');
  const sp = searchParams instanceof URLSearchParams ? Object.fromEntries(searchParams) : searchParams;
  const error = typeof sp.error === 'string' ? sp.error : null;
  const at = typeof sp.at === 'string' ? sp.at : typeof sp.saved === 'string' ? sp.saved : null;
  const templates = await listTemplates();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl">Message templates</h1>
        <p className="text-sm text-muted">
          Use only the variables listed for each template. A changed WhatsApp text must be submitted to Meta again (Settings, Notifications, Submit templates) before it can be sent.
        </p>
      </div>
      {templates.map((t) => {
        const id = `${t.key}-${t.channel}`.replace(/[^a-z0-9_-]/gi, '-');
        const d = DEFAULT_TEMPLATES[t.key];
        const vars = [...templateVariables(d.subject, d.body), STORE_NAME_VAR].filter((v, i, a) => a.indexOf(v) === i);
        return (
          <section key={id} id={id} aria-labelledby={`${id}-h`} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id={`${id}-h`} className="text-lg">
                <code>{t.key}</code> on {t.channel}
              </h2>
              <Badge tone={t.category === 'marketing' ? 'accent' : 'neutral'}>{t.category}</Badge>
              <Badge tone="outline">{t.version ? `custom, version ${t.version}` : 'default'}</Badge>
              {t.channel === 'whatsapp' ? <Badge tone="outline">{t.metaTemplateName}</Badge> : null}
            </div>
            {at === id && error ? <p className="text-sm font-medium text-danger">{error}</p> : null}
            {at === id && !error ? <p className="text-sm text-success">Saved.</p> : null}
            {t.category === 'authentication' && t.channel === 'whatsapp' ? (
              <p className="text-sm text-muted">WhatsApp sends codes with Meta&apos;s fixed authentication text; only email and SMS use this wording.</p>
            ) : null}
            <form action={saveTemplateAction} className="flex flex-col gap-2">
              <input type="hidden" name="key" value={t.key} />
              <input type="hidden" name="channel" value={t.channel} />
              {t.channel === 'email' ? <Input name="subject" defaultValue={t.subject} aria-label="Subject" maxLength={200} /> : null}
              <Textarea name="body" defaultValue={t.body} aria-label="Body" rows={4} maxLength={4000} required />
              <p className="text-xs text-muted">Variables: {vars.map((v) => `{{${v}}}`).join(' ')}</p>
              <div className="flex gap-2">
                <Button type="submit" size="sm">
                  Save
                </Button>
                {t.version ? (
                  <Button type="submit" size="sm" variant="ghost" formAction={resetTemplateAction}>
                    Reset to default
                  </Button>
                ) : null}
              </div>
            </form>
          </section>
        );
      })}
    </div>
  );
}

/** /admin/dev/outbox: what the store sent in dev and test (mock providers), with a simulated inbound WhatsApp form. */
export async function OutboxPage() {
  if (process.env.NODE_ENV === 'production' && process.env.ENABLE_MOCKS !== '1') notFound();
  await requirePermission('settings.read');
  const rows = await outboxMessages(50);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl">Dev outbox</h1>
      <form action={mockInboundAction} className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface p-4">
        <label className="flex flex-col gap-1 text-sm">
          From (WhatsApp number)
          <Input name="from" required placeholder="+919800000000" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Text
          <Input name="text" required placeholder="STOP" />
        </label>
        <Button type="submit" size="sm">
          Simulate inbound message
        </Button>
      </form>
      {rows.length === 0 ? <EmptyState title="Nothing sent yet" /> : null}
      {rows.map((r) => {
        const rendered = r.rendered as Rendered;
        return (
          <article key={r.id} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={TONE[r.status]}>{r.status}</Badge>
              <code>{r.templateKey}</code>
              <span>{r.channel}</span>
              <span className="text-muted">to {r.toMasked}</span>
              <span className="text-muted">{IST.format(r.queuedAt)}</span>
              {r.error ? <span className="text-danger">{r.error}</span> : null}
            </div>
            {rendered?.subject ? <p className="font-semibold">{rendered.subject}</p> : null}
            <pre className="whitespace-pre-wrap font-body text-sm">{rendered?.text}</pre>
            {rendered?.whatsapp?.templateName ? <p className="text-xs text-muted">WhatsApp template {rendered.whatsapp.templateName}</p> : null}
          </article>
        );
      })}
    </div>
  );
}

/** Rendered under the generated settings form on /admin/settings/notifications. */
export async function SettingsPanel() {
  await requirePermission('settings.read');
  const s = await loadSettings();
  const gmail = await gmailStatus();
  const wa = whatsappConfig(s);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 text-sm">
      {s.otpKillSwitch ? <p className="font-semibold text-danger">The OTP kill switch is on: customers cannot receive sign-in or verification codes.</p> : null}
      <p>
        Email: {gmail.mode}
        {gmail.account ? `, sending as ${gmail.account}` : ', no mailbox connected'}
      </p>
      <p>
        WhatsApp webhook URL: <code>{publicOrigin()}/api/webhooks/whatsapp</code>
        {wa ? '' : ' (WhatsApp is off or not configured)'}
      </p>
      <p className="text-muted">Subscribe the webhook to messages, message_template_status_update and template_category_update, using the verify token above.</p>
    </div>
  );
}
