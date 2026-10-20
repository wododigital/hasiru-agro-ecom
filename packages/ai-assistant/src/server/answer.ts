import { getViewer } from '@ecomkit/core/auth-context';
import { clientIp, hashIp, isSameOrigin, PayloadTooLargeError, readRawBody } from '@ecomkit/core/http';
import { captureError } from '@ecomkit/core/observability';
import { rateLimit } from '@ecomkit/core/rate-limit';
import { getSettings } from '@ecomkit/core/settings';
import { askSchema, chunkText, STREAM_PATH, type AssistantMode, type ChipProduct, type ErrorCode, type Facts, type StreamEvent } from '../domain';
import { assistantSettings, type AssistantSettings } from '../settings';
import { buildFacts } from './facts';
import { narrate, type NarrationResult } from './narrate';
import { historyFor, logTurn, startOrResume } from './transcripts';

export { STREAM_PATH };
const MAX_BODY = 4096;

export function chipsFor(facts: Facts): ChipProduct[] {
  return facts.products.map((p) => ({
    id: p.id,
    name: p.name,
    href: p.href,
    variantId: p.variantId,
    purchasable: !!p.variantId && (p.stock === 'in_stock' || p.stock === 'low_stock' || p.stock === 'preorder' || p.stock === 'unknown'),
  }));
}

export interface AnswerResult {
  conversationId: string;
  facts: Facts;
  narration: NarrationResult;
}

/**
 * Plan API `answer(question, ctx)`: rules decide (facts), the narrator words it, the turn is logged.
 * Used by the stream route and by the admin test action; callers apply rate limits.
 */
export async function answer(
  question: string,
  ctx: { mode?: AssistantMode; conversationId?: string | null; visitorId?: string | null; customerId?: string | null; settings?: AssistantSettings; onFacts?: (f: Facts, conversationId: string) => void } = {},
): Promise<AnswerResult> {
  const mode = ctx.mode ?? 'shop';
  const settings = ctx.settings ?? (await getSettings(assistantSettings));
  const conversationId = await startOrResume(ctx.conversationId, { mode, visitorId: ctx.visitorId ?? null, customerId: ctx.customerId ?? null });
  const [facts, history] = await Promise.all([buildFacts(question, mode), historyFor(conversationId)]);
  ctx.onFacts?.(facts, conversationId);
  const narration = await narrate(facts, { history, settings });
  await logTurn(conversationId, question, facts, narration);
  return { conversationId, facts, narration };
}

const errorResponse = (code: ErrorCode, status: number) => Response.json({ error: code }, { status, headers: { 'cache-control': 'no-store' } });

function safeIpHash(req: Request): string | null {
  try {
    return hashIp(clientIp(req));
  } catch {
    return null; // INTERNAL_SECRET unset (local dev): one shared bucket
  }
}

/**
 * POST /api/assistant/stream. Same-origin only (it reads the session cookie and writes a transcript), body capped,
 * zod-validated, rate limited per network address per day and per conversation per hour. Answers as NDJSON:
 * `meta` (conversation id and the products, as soon as the rules engine has them), `delta` chunks of the
 * validated reply, then `done` (or `error`).
 */
export async function handleAssistantPost(req: Request): Promise<Response> {
  if (!isSameOrigin(req)) return errorResponse('forbidden', 403);
  let input;
  try {
    const raw = await readRawBody(req, MAX_BODY);
    input = askSchema.parse(JSON.parse(raw.toString('utf8')));
  } catch (err) {
    return errorResponse('invalid', err instanceof PayloadTooLargeError ? 413 : 400);
  }
  const settings = await getSettings(assistantSettings);
  if (!settings.enabled) return errorResponse('disabled', 503);

  const viewer = await getViewer();
  const ipHash = safeIpHash(req);
  if (!(await rateLimit(`assistant-ip:${ipHash ?? 'local'}`, { limit: settings.perIpPerDay, windowSec: 86_400 })).ok) return errorResponse('rate_limited', 429);
  if (input.conversationId && !(await rateLimit(`assistant:${input.conversationId}`, { limit: settings.perConversationPerHour, windowSec: 3600 })).ok) {
    return errorResponse('rate_limited', 429);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: StreamEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      try {
        const result = await answer(input.question, {
          mode: input.mode,
          conversationId: input.conversationId,
          visitorId: ipHash,
          customerId: viewer.kind === 'customer' ? viewer.customerId : null,
          settings,
          onFacts: (facts, conversationId) => send({ type: 'meta', conversationId, products: chipsFor(facts) }),
        });
        // A new conversation counts its first question toward its hourly limit too.
        if (!input.conversationId) await rateLimit(`assistant:${result.conversationId}`, { limit: settings.perConversationPerHour, windowSec: 3600 });
        for (const text of chunkText(result.narration.answer)) send({ type: 'delta', text });
        send({ type: 'done', source: result.narration.source, productIds: result.narration.productIds, followUps: result.narration.followUps });
      } catch (err) {
        await captureError(err, { route: STREAM_PATH });
        send({ type: 'error', code: 'failed' });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
}
