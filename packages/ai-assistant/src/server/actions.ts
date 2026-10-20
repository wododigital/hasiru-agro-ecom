import type { HealthResult, JobHandler, SettingsActionResult } from '@ecomkit/core/contracts';
import { getSettings } from '@ecomkit/core/settings';
import type { Facts } from '../domain';
import { assistantSettings } from '../settings';
import { monthTokens, narrate, type FallbackReason } from './narrate';
import { pruneTranscripts } from './transcripts';

/** A fixed, neutral fact set for the connection test (no catalogue or transcript involved). */
export const TEST_FACTS: Facts = {
  mode: 'shop',
  question: 'Is the sample item in stock?',
  intents: ['stock'],
  products: [
    {
      id: '00000000-0000-7000-8000-000000000001',
      name: 'Sample item',
      href: '/',
      variantId: null,
      collectionLine: null,
      unitPaise: 45_000,
      bulk: { minQty: 50, unitPaise: 35_500 },
      stock: 'in_stock',
      bearingYears: null,
      shade: false,
      nitrogenFixer: false,
      fit: null,
      areaQty: null,
    },
  ],
  notes: ['bulk'],
  district: null,
  companionOf: null,
  acres: null,
};

const REASONS: Record<FallbackReason, string> = {
  template_mode: 'Provider is "template": the rules engine answers without a model.',
  note_only: 'Answered from a canned note.',
  mocks_disabled: 'Provider is "mock" but mocks are off here (ENABLE_MOCKS is not 1). Switch to "live" with an API key, or "template".',
  not_configured: 'No API key saved for the live provider.',
  token_cap: 'The monthly token cap is reached; answers use the template until next month.',
  error: 'The provider call failed (see Health > Integrations for the error).',
  refusal: 'The model declined the test question.',
  max_tokens: 'The reply hit the output cap. Raise "maxTokens".',
  invalid_output: 'The model returned output that did not match the expected format.',
  validator_emptied: 'The validator removed everything the model wrote (it quoted facts it was not given).',
};

/** settings action `test-connection`: one narration of TEST_FACTS through the configured provider. */
export async function testConnectionAction(): Promise<SettingsActionResult> {
  const s = await getSettings(assistantSettings);
  const r = await narrate(TEST_FACTS, { settings: { ...s, enabled: true } });
  if (r.source === 'model' || r.source === 'cache') {
    return { ok: true, message: `${r.source === 'cache' ? 'Answered from the narration cache' : `Model ${r.model} answered`} in ${r.latencyMs} ms.`, detail: { answer: r.answer, tokensIn: r.tokensIn, tokensOut: r.tokensOut } };
  }
  return { ok: false, message: `Fell back to the template. ${REASONS[r.fallbackReason ?? 'error']}`, detail: { answer: r.answer, reason: r.fallbackReason } };
}

/** Health card: configured provider and token use against the cap. */
export async function assistantHealth(): Promise<HealthResult> {
  const s = await getSettings(assistantSettings);
  if (!s.enabled) return { status: 'not_configured', detail: 'Assistant switched off' };
  if (s.provider === 'live' && !s.apiKey) return { status: 'degraded', detail: 'Live provider without an API key: template answers only' };
  if (s.provider === 'mock' && process.env.ENABLE_MOCKS !== '1') return { status: 'degraded', detail: 'Mock provider outside dev/test: template answers only' };
  const used = await monthTokens();
  if (s.monthlyTokenCap > 0 && used >= s.monthlyTokenCap) return { status: 'degraded', detail: `Monthly token cap reached (${used})` };
  return { status: 'ok', detail: `${s.provider}, ${s.model}, ${used} tokens this month` };
}

/** Job `ai-assistant.prune`: nightly retention. */
export const pruneJob: JobHandler = async (_data, ctx) => {
  const s = await getSettings(assistantSettings);
  const r = await pruneTranscripts(s.transcriptDays);
  ctx.log.info('assistant transcripts pruned', r);
};
