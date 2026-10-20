import { defineSettings } from '@ecomkit/core/settings';
import { z } from 'zod';

/** Narration models the admin can pick (exact provider ids). */
export const NARRATION_MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5'] as const;
export const PROVIDERS = ['template', 'mock', 'live'] as const;
export const MOCK_BEHAVIOURS = ['normal', 'refusal', 'error', 'slow', 'invalid', 'hallucinate'] as const;

/** Settings for /admin/settings/ai-assistant (rendered by admin-shell from this schema). */
export const assistantSettingsSchema = z.object({
  enabled: z.boolean().default(true).meta({ group: 'General', help: 'Show the assistant on the storefront. Off answers every request with a short "not available" note.' }),
  provider: z
    .enum(PROVIDERS)
    .default('mock')
    .meta({ group: 'General', help: 'template: rules engine answers alone, no model. mock: the local mock model (dev and test only; falls back to template elsewhere). live: the model provider with the API key below.' }),
  apiKey: z.string().optional().meta({ group: 'Model', secret: true, help: 'Anthropic API key. Needed for provider "live".', placeholder: 'sk-ant-...' }),
  model: z.enum(NARRATION_MODELS).default('claude-haiku-5-5').meta({ group: 'Model', help: 'Haiku is fast and cheap; Sonnet writes richer replies at about 20 times the cost.' }),
  effort: z.enum(['low', 'medium']).default('low').meta({ group: 'Model', help: 'Thinking effort. Low is enough: the rules engine has already decided the answer.' }),
  maxTokens: z.number().int().min(1000).max(16_000).default(4000).meta({ group: 'Model', help: 'Output cap per reply (thinking counts toward it). A reply cut short falls back to the template.' }),
  monthlyTokenCap: z.number().int().min(0).default(0).meta({ group: 'Limits', help: 'Model tokens per calendar month (IST). 0 = no cap. Over the cap every reply uses the template.' }),
  perConversationPerHour: z.number().int().min(1).max(500).default(20).meta({ group: 'Limits', help: 'Questions per conversation per hour.' }),
  perIpPerDay: z.number().int().min(1).max(5000).default(100).meta({ group: 'Limits', help: 'Questions per visitor network address per day.' }),
  transcriptDays: z.number().int().min(7).max(730).default(90).meta({ group: 'Limits', help: 'Transcripts older than this are deleted every night.' }),
  mockBehaviour: z
    .enum(MOCK_BEHAVIOURS)
    .default('normal')
    .meta({ group: 'Testing', help: 'Only for provider "mock": make the mock refuse, fail, answer slowly, return broken output or invent products, to check the fallbacks.' }),
});

export const assistantSettings = defineSettings('ai-assistant', assistantSettingsSchema);
export type AssistantSettings = z.infer<typeof assistantSettingsSchema>;
