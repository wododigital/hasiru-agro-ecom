import { z } from 'zod';
import { MAX_QUESTION } from './stream';
import { MODES } from './types';

/** POST /api/assistant/stream body. History is read from the transcript on the server, never trusted from the client. */
export const askSchema = z.object({
  question: z.string().trim().min(1).max(MAX_QUESTION),
  mode: z.enum(MODES).default('shop'),
  conversationId: z.uuid().nullish(),
});
export type AskInput = z.infer<typeof askSchema>;

/** Structured output the narrator must return (`output_config.format`). Lengths are checked by the validator. */
export const narrationSchema = z.object({
  answer: z.string(),
  productIds: z.array(z.string()),
  followUps: z.array(z.string()),
});

