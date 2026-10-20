import { requirePermission } from '@ecomkit/core/auth-context';
import { db } from '@ecomkit/core/db';
import { newId } from '@ecomkit/core/ids';
import { and, asc, count, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { HISTORY_TURNS, type AssistantMode, type Facts } from '../domain';
import { aiConversation, aiMessage, aiNarrationCache, type ConversationRow, type MessageRow } from '../schema';
import type { HistoryTurn, NarrationResult } from './narrate';

/** Resumes a known conversation or starts a new one (an unknown id from the client starts a new one). */
export async function startOrResume(id: string | null | undefined, ctx: { mode: AssistantMode; visitorId: string | null; customerId: string | null }): Promise<string> {
  if (id) {
    const [row] = await db
      .update(aiConversation)
      .set({ lastAt: new Date(), mode: ctx.mode, ...(ctx.customerId ? { customerId: ctx.customerId } : {}) })
      .where(eq(aiConversation.id, id))
      .returning({ id: aiConversation.id });
    if (row) return row.id;
  }
  const newConv = newId();
  await db.insert(aiConversation).values({ id: newConv, mode: ctx.mode, visitorId: ctx.visitorId, customerId: ctx.customerId });
  return newConv;
}

interface StoredFacts {
  products?: { id: string; name: string }[];
}

/** Replaces `[[id]]` tokens with the product names recorded with that answer. */
export function tokensToNames(text: string, products: readonly { id: string; name: string }[]): string {
  const names = new Map(products.map((p) => [p.id, p.name]));
  return text.replace(/\[\[([^\]]+)\]\]/g, (_, id: string) => names.get(id) ?? '');
}

/** The last turns of a conversation, oldest first, as plain text for the narrator. */
export async function historyFor(conversationId: string, turns = HISTORY_TURNS): Promise<HistoryTurn[]> {
  const rows = await db
    .select({ role: aiMessage.role, content: aiMessage.content, facts: aiMessage.facts })
    .from(aiMessage)
    .where(eq(aiMessage.conversationId, conversationId))
    .orderBy(desc(aiMessage.createdAt), desc(aiMessage.id))
    .limit(turns);
  const list = rows.reverse().map((r) => ({ role: r.role, text: r.role === 'assistant' ? tokensToNames(r.content, (r.facts as StoredFacts | null)?.products ?? []) : r.content }));
  // The conversation sent to the model must start with a user turn.
  while (list[0]?.role === 'assistant') list.shift();
  return list;
}

/** Writes the question and the answer (with the facts behind it) in one transaction. */
export async function logTurn(conversationId: string, question: string, facts: Facts, n: NarrationResult): Promise<void> {
  const now = Date.now();
  await db.transaction(async (tx) => {
    await tx.insert(aiMessage).values({ id: newId(), conversationId, role: 'user', content: question, createdAt: new Date(now) });
    await tx.insert(aiMessage).values({
      id: newId(),
      conversationId,
      role: 'assistant',
      content: n.answer,
      productIds: n.productIds,
      facts: {
        intents: facts.intents,
        notes: facts.notes,
        district: facts.district,
        companionOf: facts.companionOf,
        products: facts.products.map((p) => ({ id: p.id, name: p.name, unitPaise: p.unitPaise, stock: p.stock })),
        fallbackReason: n.fallbackReason,
        droppedRefs: n.droppedRefs,
        droppedSentences: n.droppedSentences,
        cacheReadTokens: n.cacheReadTokens,
      },
      model: n.model,
      source: n.source,
      tokensIn: n.tokensIn,
      tokensOut: n.tokensOut,
      latencyMs: n.latencyMs,
      // One millisecond after the question so the order is stable.
      createdAt: new Date(now + 1),
    });
  });
}

// ---- admin ----------------------------------------------------------------------------------------------------

export interface ConversationListRow {
  id: string;
  mode: string;
  startedAt: Date;
  lastAt: Date;
  customerId: string | null;
  questions: number;
  firstQuestion: string | null;
  fallbacks: number;
}

/** Transcripts list (staff with customers.read). `q` searches question text. */
export async function listConversations(options: { q?: string | null; page?: number; pageSize?: number } = {}): Promise<{ rows: ConversationListRow[]; total: number }> {
  await requirePermission('customers.read');
  const pageSize = options.pageSize ?? 25;
  const page = Math.max(1, options.page ?? 1);
  const where = options.q
    ? sql`${aiConversation.id} in (select m.conversation_id from ai_message m where m.role = 'user' and m.content ilike ${`%${options.q.replace(/[%_\\]/g, '\\$&')}%`})`
    : undefined;
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: aiConversation.id,
        mode: aiConversation.mode,
        startedAt: aiConversation.startedAt,
        lastAt: aiConversation.lastAt,
        customerId: aiConversation.customerId,
        questions: sql<number>`(select count(*)::int from ai_message m where m.conversation_id = ${aiConversation.id} and m.role = 'user')`,
        firstQuestion: sql<string | null>`(select m.content from ai_message m where m.conversation_id = ${aiConversation.id} and m.role = 'user' order by m.created_at limit 1)`,
        fallbacks: sql<number>`(select count(*)::int from ai_message m where m.conversation_id = ${aiConversation.id} and m.role = 'assistant' and m.source = 'template')`,
      })
      .from(aiConversation)
      .where(where)
      .orderBy(desc(aiConversation.lastAt), desc(aiConversation.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: count() }).from(aiConversation).where(where),
  ]);
  return { rows, total: total?.n ?? 0 };
}

export async function getConversation(id: string): Promise<{ conversation: ConversationRow; messages: MessageRow[] } | null> {
  await requirePermission('customers.read');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [conversation] = await db.select().from(aiConversation).where(eq(aiConversation.id, id)).limit(1);
  if (!conversation) return null;
  const messages = await db.select().from(aiMessage).where(eq(aiMessage.conversationId, id)).orderBy(asc(aiMessage.createdAt), asc(aiMessage.id));
  return { conversation, messages };
}

/** Usage for the admin header: questions, model answers, fallbacks and tokens since `since`. */
export async function usageSince(since: Date): Promise<{ questions: number; model: number; cache: number; template: number; tokens: number }> {
  await requirePermission('customers.read');
  const rows = await db
    .select({ source: aiMessage.source, n: count(), tokens: sql<number>`coalesce(sum(${aiMessage.tokensIn} + ${aiMessage.tokensOut}), 0)::int` })
    .from(aiMessage)
    .where(and(eq(aiMessage.role, 'assistant'), sql`${aiMessage.createdAt} >= ${since.toISOString()}::timestamptz`))
    .groupBy(aiMessage.source);
  const by = (s: string) => rows.find((r) => r.source === s);
  return {
    questions: rows.reduce((a, r) => a + r.n, 0),
    model: by('model')?.n ?? 0,
    cache: by('cache')?.n ?? 0,
    template: by('template')?.n ?? 0,
    tokens: rows.reduce((a, r) => a + r.tokens, 0),
  };
}

/** Nightly job: transcripts older than the retention window and narration cache rows older than 30 days. */
export async function pruneTranscripts(days: number, now = new Date()): Promise<{ conversations: number; cache: number }> {
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const cacheCutoff = new Date(now.getTime() - 30 * 86_400_000);
  const old = await db.select({ id: aiConversation.id }).from(aiConversation).where(lt(aiConversation.lastAt, cutoff));
  if (old.length) await db.delete(aiConversation).where(inArray(aiConversation.id, old.map((r) => r.id)));
  const cache = await db.delete(aiNarrationCache).where(lt(aiNarrationCache.createdAt, cacheCutoff)).returning({ hash: aiNarrationCache.hash });
  return { conversations: old.length, cache: cache.length };
}

