// The narrator: turns rules-engine facts into a reply. Provider adapter for the model API (the vendor SDK is named
// here and in settings only), narration cache, monthly token cap, validator and the template fallback.
import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { db } from '@ecomkit/core/db';
import { integrationCall, NotConfiguredError, safeFetch } from '@ecomkit/core/http';
import { getSettings } from '@ecomkit/core/settings';
import { and, eq, gte, sql } from 'drizzle-orm';
import {
  factsMessage,
  hasSubstance,
  narrationSchema,
  PROMPT_VERSION,
  resolveRefs,
  systemPrompt,
  templateNarration,
  toModelFacts,
  validateNarration,
  type AnswerSource,
  type Facts,
  type Narration,
} from '../domain';
import { aiMessage, aiNarrationCache } from '../schema';
import { assistantSettings, type AssistantSettings } from '../settings';
import { assistantRuntime } from './runtime';

export const PROVIDER_HOST = 'api.anthropic.com';
/** Integration log provider name (monitoring's integration cards read core_integration_log). */
export const INTEGRATION = 'assistant-model';

export type FallbackReason =
  | 'template_mode'
  | 'note_only'
  | 'mocks_disabled'
  | 'not_configured'
  | 'token_cap'
  | 'error'
  | 'refusal'
  | 'max_tokens'
  | 'invalid_output'
  | 'validator_emptied';

export interface NarrationResult extends Narration {
  source: AnswerSource;
  model: string | null;
  fallbackReason: FallbackReason | null;
  tokensIn: number;
  tokensOut: number;
  cacheReadTokens: number;
  latencyMs: number;
  droppedRefs: string[];
  droppedSentences: string[];
}

/** One prior turn as plain text (product tokens already replaced by names). */
export interface HistoryTurn {
  role: 'user' | 'assistant';
  text: string;
}

const IST_OFFSET_MS = 5.5 * 3_600_000;
/** Start of the current calendar month in IST, as a UTC instant. */
export function istMonthStart(now: Date): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - IST_OFFSET_MS);
}

/** Model tokens used this month (input + output of model answers). */
export async function monthTokens(now = new Date()): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${aiMessage.tokensIn} + ${aiMessage.tokensOut}), 0)::int` })
    .from(aiMessage)
    .where(and(eq(aiMessage.source, 'model'), gte(aiMessage.createdAt, istMonthStart(now))));
  return row?.n ?? 0;
}

export function narrationCacheKey(s: Pick<AssistantSettings, 'model' | 'effort' | 'provider'>, storeContext: string | null, history: readonly HistoryTurn[], factsText: string): string {
  return createHash('sha256').update(JSON.stringify([PROMPT_VERSION, s.provider, s.model, s.effort, storeContext, history, factsText])).digest('hex');
}

/** fetch over core's SSRF-guarded client, pinned to the provider host. */
const guardedFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const body = init?.body;
  return safeFetch(
    url,
    { method: init?.method, headers: init?.headers, body: typeof body === 'string' || body instanceof Uint8Array ? body : body == null ? null : String(body), signal: init?.signal ?? undefined },
    { allowHosts: [PROVIDER_HOST], timeoutMs: 45_000 },
  );
};

function client(s: AssistantSettings): Anthropic {
  const transport = assistantRuntime().transport;
  if (s.provider === 'mock') {
    const base = process.env.INTERNAL_BASE_URL ?? 'http://127.0.0.1:3000';
    return new Anthropic({
      apiKey: 'mock-key',
      baseURL: new URL('/api/_mock/claude', base).href,
      fetch: transport ?? fetch,
      maxRetries: 0,
      timeout: 20_000,
      defaultHeaders: { 'x-mock-behaviour': s.mockBehaviour },
    });
  }
  if (!s.apiKey) throw new NotConfiguredError(INTEGRATION);
  return new Anthropic({ apiKey: s.apiKey, fetch: transport ?? guardedFetch, maxRetries: 1, timeout: 45_000 });
}

type ModelCall =
  | { ok: true; narration: Narration; tokensIn: number; tokensOut: number; cacheReadTokens: number }
  | { ok: false; reason: 'refusal' | 'max_tokens' | 'invalid_output'; tokensIn: number; tokensOut: number };

async function callModel(s: AssistantSettings, system: string, history: readonly HistoryTurn[], factsText: string): Promise<ModelCall> {
  const res = await client(s).messages.parse({
    model: s.model,
    max_tokens: s.maxTokens,
    // Stable prefix first (cached): system prompt. Volatile parts after it: history and this turn's facts.
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [...history.map((t) => ({ role: t.role, content: t.text })), { role: 'user' as const, content: factsText }],
    output_config: { effort: s.effort, format: zodOutputFormat(narrationSchema) },
  });
  const tokensIn = (res.usage.input_tokens ?? 0) + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0);
  const tokensOut = res.usage.output_tokens ?? 0;
  if (res.stop_reason === 'refusal') return { ok: false, reason: 'refusal', tokensIn, tokensOut };
  if (res.stop_reason === 'max_tokens') return { ok: false, reason: 'max_tokens', tokensIn, tokensOut };
  if (!res.parsed_output) return { ok: false, reason: 'invalid_output', tokensIn, tokensOut };
  return { ok: true, narration: res.parsed_output, tokensIn, tokensOut, cacheReadTokens: res.usage.cache_read_input_tokens ?? 0 };
}

/**
 * Narrates facts. Order: template mode / caps -> narration cache -> model -> validator; every failure (provider
 * error, refusal, cut-off, unparseable or ungrounded output) falls back to the deterministic template, so a
 * visitor always gets an answer built from the same facts.
 */
export async function narrate(facts: Facts, options: { history?: readonly HistoryTurn[]; settings?: AssistantSettings; now?: Date } = {}): Promise<NarrationResult> {
  const started = performance.now();
  const rt = assistantRuntime();
  const s = options.settings ?? (await getSettings(assistantSettings));
  const history = options.history ?? [];
  const { view, refs } = toModelFacts(facts, rt.messages);
  const suggestions = rt.messages.suggestions[facts.mode] ?? [];
  const base = { model: null, tokensIn: 0, tokensOut: 0, cacheReadTokens: 0, droppedRefs: [] as string[], droppedSentences: [] as string[] };
  const done = (n: Narration, source: AnswerSource, extra: Partial<NarrationResult> = {}): NarrationResult => ({
    ...base,
    ...resolveRefs(n, refs),
    source,
    fallbackReason: null,
    latencyMs: Math.round(performance.now() - started),
    ...extra,
  });
  const fallback = (fallbackReason: FallbackReason, extra: Partial<NarrationResult> = {}) => done(templateNarration(view, suggestions), 'template', { fallbackReason, ...extra });

  if (s.provider === 'template') return fallback('template_mode');
  if (s.provider === 'mock' && process.env.ENABLE_MOCKS !== '1') return fallback('mocks_disabled');
  if (s.provider === 'live' && !s.apiKey) return fallback('not_configured');
  // Nothing to narrate beyond a canned note: the template says it best and costs nothing.
  if (!view.products.length && view.notes.length <= 1 && !history.length) return fallback('note_only');
  if (s.monthlyTokenCap > 0 && (await monthTokens(options.now)) >= s.monthlyTokenCap) return fallback('token_cap');

  const factsText = factsMessage(view);
  const key = narrationCacheKey(s, rt.storeContext, history, factsText);
  const [cached] = await db.select().from(aiNarrationCache).where(eq(aiNarrationCache.hash, key)).limit(1);
  if (cached) {
    await db.update(aiNarrationCache).set({ hits: sql`${aiNarrationCache.hits} + 1` }).where(eq(aiNarrationCache.hash, key));
    return done(cached.output, 'cache', { model: cached.model });
  }

  const call = await integrationCall(INTEGRATION, 'narrate', () => callModel(s, systemPrompt(rt.storeContext), history, factsText));
  if (call.status === 'skipped_not_configured') return fallback('not_configured');
  if (call.status === 'failed') return fallback(call.error.name === 'SyntaxError' || /parse|json|zod/i.test(call.error.message) ? 'invalid_output' : 'error');
  const result = call.value;
  if (!result.ok) return fallback(result.reason, { model: s.model, tokensIn: result.tokensIn, tokensOut: result.tokensOut });

  const checked = validateNarration(result.narration, view, rt.messages.countWords);
  const usage = { model: s.model, tokensIn: result.tokensIn, tokensOut: result.tokensOut, cacheReadTokens: result.cacheReadTokens, droppedRefs: checked.droppedRefs, droppedSentences: checked.droppedSentences };
  if (!hasSubstance(checked.narration)) return fallback('validator_emptied', usage);
  await db.insert(aiNarrationCache).values({ hash: key, model: s.model, output: checked.narration }).onConflictDoNothing();
  return done(checked.narration, 'model', usage);
}
