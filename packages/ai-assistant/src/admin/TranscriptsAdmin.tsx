// Admin: assistant transcripts (copy is English-only, exempt from messages). Staff with customers.read.
import { ForbiddenError } from '@ecomkit/core/auth-context';
import { Badge, DataTable, Stat, type Column } from '@ecomkit/ui';
import { parseTableParams, type SearchParamsInput } from '@ecomkit/ui/domain';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { parseAnswer, type Block, type Inline } from '../domain';
import { getConversation, istMonthStart, listConversations, usageSince, type ConversationListRow } from '../server';

const PAGE = 25;
const BASE = '/admin/assistant';
const when = (d: Date) => d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

function NoAccess() {
  return <p className="text-sm text-muted">You do not have access to assistant transcripts.</p>;
}

export async function TranscriptsPage({ searchParams }: { searchParams: SearchParamsInput }) {
  const params = parseTableParams(searchParams);
  let data;
  try {
    const list = await listConversations({ q: params.q, page: params.page, pageSize: PAGE });
    // The clock is read only after the request-time permission check (cache components).
    data = { ...list, usage: await usageSince(istMonthStart(new Date())) };
  } catch (err) {
    if (err instanceof ForbiddenError) return <NoAccess />;
    throw err;
  }
  const columns: Column<ConversationListRow>[] = [
    {
      id: 'first',
      header: 'First question',
      cell: (r) => (
        <Link className="text-primary underline" href={`${BASE}/${r.id}`}>
          {r.firstQuestion ?? '(empty)'}
        </Link>
      ),
    },
    { id: 'mode', header: 'Mode', cell: (r) => r.mode },
    { id: 'questions', header: 'Questions', align: 'right', cell: (r) => r.questions },
    { id: 'fallbacks', header: 'Template answers', align: 'right', cell: (r) => (r.fallbacks ? <Badge tone="warning">{r.fallbacks}</Badge> : 0) },
    { id: 'customer', header: 'Signed in', cell: (r) => (r.customerId ? 'Yes' : 'No') },
    { id: 'last', header: 'Last activity', cell: (r) => when(r.lastAt) },
  ];
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Assistant transcripts</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Answers this month" value={data.usage.questions} />
        <Stat label="Model answers" value={data.usage.model} />
        <Stat label="Cache and template answers" value={data.usage.cache + data.usage.template} />
        <Stat label="Model tokens this month" value={data.usage.tokens.toLocaleString('en-IN')} />
      </div>
      <p className="text-sm text-muted">
        Model, limits and the test button live in <Link className="underline" href="/admin/settings/ai-assistant">Settings: Assistant</Link>. Transcripts are deleted after the retention period set there.
      </p>
      <DataTable columns={columns} rows={data.rows} rowKey={(r) => r.id} params={params} total={data.total} pageSize={PAGE} basePath={BASE} />
    </div>
  );
}

function InlineText({ parts, names }: { parts: Inline[]; names: Map<string, string> }) {
  return (
    <>
      {parts.map((p, i) =>
        p.kind === 'text' ? (
          <span key={i}>{p.text}</span>
        ) : p.kind === 'bold' ? (
          <strong key={i}>{p.text}</strong>
        ) : (
          <Badge key={i} tone="neutral">
            {names.get(p.id) ?? p.id}
          </Badge>
        ),
      )}
    </>
  );
}

function Answer({ blocks, names }: { blocks: Block[]; names: Map<string, string> }) {
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((b, i) =>
        b.kind === 'p' ? (
          <p key={i}>
            <InlineText parts={b.parts} names={names} />
          </p>
        ) : (
          <ul key={i} className="list-disc pl-5">
            {b.items.map((item, j) => (
              <li key={j}>
                <InlineText parts={item} names={names} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

export async function TranscriptPage({ id }: { id: string }) {
  let data;
  try {
    data = await getConversation(id);
  } catch (err) {
    if (err instanceof ForbiddenError) return <NoAccess />;
    throw err;
  }
  if (!data) notFound();
  const { conversation: c, messages } = data;
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Link href={BASE} className="text-sm underline">
        All transcripts
      </Link>
      <h1 className="text-2xl font-semibold">Conversation</h1>
      <p className="text-sm text-muted">
        Started {when(c.startedAt)}, mode {c.mode}, {c.customerId ? 'signed-in customer' : 'guest'}.
      </p>
      <ol className="flex flex-col gap-3">
        {messages.map((m) => {
          const facts = (m.facts ?? {}) as { products?: { id: string; name: string }[]; fallbackReason?: string | null; droppedRefs?: string[]; droppedSentences?: string[]; intents?: string[] };
          const names = new Map((facts.products ?? []).map((p) => [p.id, p.name]));
          return (
            <li key={m.id} className={m.role === 'user' ? 'self-end rounded-md bg-surface-2 p-3' : 'rounded-md border border-border bg-surface p-3'}>
              {m.role === 'user' ? (
                <p>{m.content}</p>
              ) : (
                <div className="flex flex-col gap-2 text-sm">
                  <Answer blocks={parseAnswer(m.content)} names={names} />
                  <p className="flex flex-wrap gap-2 text-xs text-muted">
                    <Badge tone={m.source === 'model' ? 'success' : m.source === 'cache' ? 'neutral' : 'warning'}>{m.source ?? '-'}</Badge>
                    {m.model ? <span>{m.model}</span> : null}
                    {facts.fallbackReason ? <span>fallback: {facts.fallbackReason}</span> : null}
                    {facts.intents?.length ? <span>intents: {facts.intents.join(', ')}</span> : null}
                    <span>
                      {m.tokensIn} in / {m.tokensOut} out
                    </span>
                    {m.latencyMs != null ? <span>{m.latencyMs} ms</span> : null}
                  </p>
                  {facts.droppedRefs?.length || facts.droppedSentences?.length ? (
                    <p className="text-xs text-warning">
                      Validator removed {facts.droppedRefs?.length ?? 0} unknown product reference(s) and {facts.droppedSentences?.length ?? 0} sentence(s) with unsupported prices or counts.
                    </p>
                  ) : null}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
