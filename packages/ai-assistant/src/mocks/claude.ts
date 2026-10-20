// Mock of the model provider's Messages API for dev and test. Route: /api/_mock/claude/[...path]; 404 unless
// ENABLE_MOCKS=1. It reads the FACTS block of the last user message and answers with the deterministic template,
// shaped like a real structured-output response. `x-mock-behaviour` (set from the assistant settings) switches it
// to refuse, fail, stall, return broken JSON or invent products and prices, so every fallback can be exercised.
import { createHash } from 'node:crypto';
import { MOCK_BEHAVIOURS } from '../settings';
import { readFactsMessage, templateNarration } from '../domain';

type Behaviour = (typeof MOCK_BEHAVIOURS)[number];
const enabled = () => process.env.ENABLE_MOCKS === '1';
const g = globalThis as unknown as { __ecomkitAssistantMockPrefixes?: Set<string> };
const seenPrefixes = () => (g.__ecomkitAssistantMockPrefixes ??= new Set());
const tokens = (s: string) => Math.ceil(s.length / 4);

interface Body {
  model?: string;
  system?: string | { type: 'text'; text: string }[];
  messages?: { role: string; content: string | { type: string; text?: string }[] }[];
}

const textOf = (c: string | { type: string; text?: string }[] | undefined): string => (typeof c === 'string' ? c : (c ?? []).map((b) => b.text ?? '').join(''));

function message(model: string, content: unknown[], stopReason: string, usage: Record<string, number>, extra: Record<string, unknown> = {}) {
  return Response.json({ id: `msg_mock_${Date.now().toString(36)}`, type: 'message', role: 'assistant', model, content, stop_reason: stopReason, stop_sequence: null, usage, ...extra });
}

export async function POST(req: Request): Promise<Response> {
  if (!enabled()) return new Response(null, { status: 404 });
  const path = new URL(req.url).pathname.split('/api/_mock/claude/')[1] ?? '';
  if (path !== 'v1/messages') return Response.json({ type: 'error', error: { type: 'not_found_error', message: `unknown path ${path}` } }, { status: 404 });
  const behaviour = ((MOCK_BEHAVIOURS as readonly string[]).includes(req.headers.get('x-mock-behaviour') ?? '') ? req.headers.get('x-mock-behaviour') : 'normal') as Behaviour;
  const body = (await req.json().catch(() => ({}))) as Body;
  const model = body.model ?? 'mock';

  if (behaviour === 'error') return Response.json({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded (mock)' } }, { status: 529 });
  if (behaviour === 'slow') await new Promise((r) => setTimeout(r, 3000));

  const system = typeof body.system === 'string' ? body.system : (body.system ?? []).map((b) => b.text).join('');
  const prefixKey = createHash('sha256').update(system).digest('hex');
  const cached = seenPrefixes().has(prefixKey);
  seenPrefixes().add(prefixKey);
  const last = textOf(body.messages?.at(-1)?.content);
  const usage = { input_tokens: tokens(last), cache_read_input_tokens: cached ? tokens(system) : 0, cache_creation_input_tokens: cached ? 0 : tokens(system), output_tokens: 0 };

  if (behaviour === 'refusal') return message(model, [], 'refusal', { ...usage, output_tokens: 2 }, { stop_details: { type: 'refusal', category: null, explanation: 'Declined (mock)' } });

  const view = readFactsMessage(last);
  if (!view) return Response.json({ type: 'error', error: { type: 'invalid_request_error', message: 'no FACTS block in the last user message (mock)' } }, { status: 400 });
  const narration = templateNarration(view);
  if (behaviour === 'hallucinate') {
    narration.answer = `${narration.answer}\n\n- [[p99]]: Rs 1 each, a bargain.\n\nBuy 9,999 saplings today for only Rs 7 each.`;
    narration.productIds = [...narration.productIds, 'p99'];
  }
  const text = behaviour === 'invalid' ? 'Sorry, here is some text that is not JSON.' : JSON.stringify(narration);
  return message(model, [{ type: 'text', text }], 'end_turn', { ...usage, output_tokens: tokens(text) });
}

/** For tests and the dev console. */
export const resetAssistantMock = () => void delete g.__ecomkitAssistantMockPrefixes;
