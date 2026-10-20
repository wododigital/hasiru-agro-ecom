// Wire types and constants shared by the route and the drawer (no zod here: this file ships to the browser).
export const MAX_QUESTION = 400;
/** Turns of earlier conversation sent to the narrator (user + assistant messages count separately). */
export const HISTORY_TURNS = 8;

/** A product the drawer can render as an inline "+ cart" chip. */
export interface ChipProduct {
  id: string;
  name: string;
  href: string;
  variantId: string | null;
  purchasable: boolean;
}

export type AnswerSource = 'model' | 'cache' | 'template';
export type ErrorCode = 'rate_limited' | 'disabled' | 'invalid' | 'failed' | 'forbidden';

/** One NDJSON line of the answer stream. */
export type StreamEvent =
  | { type: 'meta'; conversationId: string; products: ChipProduct[] }
  | { type: 'delta'; text: string }
  | { type: 'done'; source: AnswerSource; productIds: string[]; followUps: string[] }
  | { type: 'error'; code: ErrorCode };

/** Splits an answer into small deltas (a few words each) for the stream. */
export function chunkText(text: string, wordsPerChunk = 4): string[] {
  const tokens = text.match(/\S+\s*/g) ?? [];
  const leading = /^\s*/.exec(text)![0];
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i += wordsPerChunk) out.push(tokens.slice(i, i + wordsPerChunk).join(''));
  if (leading && out.length) out[0] = leading + out[0];
  return out;
}

/** The answer stream route (manifest `routes`). */
export const STREAM_PATH = '/api/assistant/stream';
