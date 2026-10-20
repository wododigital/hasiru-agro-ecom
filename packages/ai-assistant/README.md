# @ecomkit/ai-assistant

Rules-first shopping assistant. A deterministic rules engine reads the live catalogue and decides the answer (which products, prices, bulk tiers, stock, district fit, companions, area quantities, policy notes). A language model only words those facts; a validator removes anything it adds. Every failure falls back to a template built from the same facts, so a visitor always gets a grounded answer.

Hard dependencies: `core`, `catalog`. Optional (through the registry, absent means the fact is simply missing): `pricing` (prices, bulk tiers), `inventory` (stock), `places` (district fit), `cart` (inline "+ cart" chips and card buttons), `planting` (companions, through `configureAssistant({ companions })`).

## How an answer is made

1. `parseQuestion` (domain): intents from the messages lexicon (bulk, delivery, returns, shade, stock, companions, fit, greeting, nitrogen, bearing, offTopic), a price cap ("under Rs 400"), "bears within N years", acres, a place name. No store vocabulary in code: category and product words are matched against the catalogue itself.
2. `selectCandidates` + `listDecision` + `rankProducts` (domain), `buildFacts` (server): retrieval over names, categories and tags (best-matching tier only), attribute filters, live price and stock (one batched call per module), price cap, in stock first, district fit (poor fits dropped), companions (catalog `companion` relations by default), plants for an area from catalog spacing. Result: `Facts`.
3. `toModelFacts`: the narrator's view. Products sit behind short refs (`p1`..`p6`, never ids); every number is pre-formatted (`Rs 450 each`, `Rs 355 each from 50`).
4. `narrate`: template mode, caps and the narration cache first; then one structured-output call (`output_config.format` with `narrationSchema`, effort from settings, stable system prompt first with `cache_control` so it is prompt-cached); `refusal`, `max_tokens`, provider errors and unparseable output fall back to `templateNarration`.
5. `validateNarration`: drops unknown refs, drops any sentence quoting a rupee amount or an item count that is not in the facts (or typed by the visitor), rewrites em/en dashes, flattens headings and tables. If nothing useful is left, template. Refs are then resolved to product ids (`[[<uuid>]]`).
6. The route streams NDJSON: `meta` (conversation id + chip products, as soon as the facts exist), `delta` chunks of the validated answer, `done` (source, product ids, follow-up questions) or `error`.

## Public API

| Export | What |
|---|---|
| `./server` | `answer(question, ctx)`, `narrate(facts, { history, settings })`, `buildFacts(question, mode)`, `handleAssistantPost(req)`, `configureAssistant({ registry, companions, storeContext, messages, readDistrict, transport })`, transcripts (`listConversations`, `getConversation`, `historyFor`, `usageSince`, `pruneTranscripts`), `testConnectionAction`, `assistantHealth`, `assistantSettings` |
| `./domain` | pure: `parseQuestion`, `selectCandidates`, `listDecision`, `rankProducts`, `qtyForArea`, `notesFor`, `toModelFacts`, `templateNarration`, `validateNarration`, `parseAnswer` (markdown-lite), `systemPrompt`, `askSchema`, `narrationSchema`, stream types |
| `./ui` | `AssistantDrawer` (server; header button + lazily loaded drawer island), `AssistantTriggerIsland`, `loadAssistantCards` (server action returning the catalog `ProductCard` rail) |
| `./admin` | `TranscriptsPage`, `TranscriptPage` |
| `./messages` | `assistantMessages` (default copy, suggestions, lexicon, count words), `mergeAssistantMessages` |

## Binding the host (WP-28)

```ts
import { configureAssistant } from '@ecomkit/ai-assistant/server';
configureAssistant({
  registry,                          // apps/<app>/src/generated/registry
  messages: en.assistant,            // store copy: delivery, returns, title ("Ask our plant expert"), suggestions
  storeContext: en.assistant.storeContext, // one or two sentences for the system prompt
  companions: plantingCompanions,    // optional: planting's "grows well with"; default = catalog companion relations
});
```

Mount `<AssistantDrawer />` in the storefront header (`(shop)/layout.tsx`). It renders static markup, so it does not break the prerendered shell; the drawer chunk loads on hover/focus/touch and mounts on first click.

## Tables

`ai_conversation` (id, visitor_id = salted IP hash, customer_id, mode, started_at, last_at), `ai_message` (role, content, product_ids, facts jsonb, model, source `model|cache|template`, tokens_in, tokens_out, latency_ms), `ai_narration_cache` (hash = sha256 of prompt version, provider, model, effort, store context, history and facts; output; hits). No foreign keys to other modules.

## Routes

- `POST /api/assistant/stream`: same-origin only (403), body cap 4 KB (413), zod body `{ question (1..400), mode shop|plan|farm, conversationId? }` (400), `disabled` (503), rate limits (429). History is read from the transcript, never from the client.
- Mock (dev/test configs only, and 404 unless `ENABLE_MOCKS=1`): `POST /api/_mock/claude/v1/messages`, a Messages API stand-in that answers with the template from the FACTS block; `x-mock-behaviour` (from settings) = `refusal | error | slow | invalid | hallucinate`.
- Admin: `/admin/assistant` (transcripts list, monthly usage), `/admin/assistant/[id]` (one conversation: source, model, tokens, fallback reason, what the validator removed). Permission `customers.read`. Nav: Customers band (340).

## Settings (`/admin/settings/ai-assistant`, rendered by admin-shell)

`enabled`, `provider` (`template | mock | live`, default `mock`; mock outside dev/test falls back to template), `apiKey` (secret), `model` (`claude-haiku-5-5` default, `claude-sonnet-5-5`), `effort` (`low` default, `medium`), `maxTokens` (4000), `monthlyTokenCap` (0 = none), `perConversationPerHour` (20), `perIpPerDay` (100), `transcriptDays` (90), `mockBehaviour`. Action: **Test the assistant** (`test-connection`) narrates a fixed sample through the configured provider and reports the result or the fallback reason.

## Events, jobs, health

Emits `integration.failed` (through core `integrationCall`, provider `assistant-model`). Job `ai-assistant.prune` nightly 03:40 IST: transcripts past retention, narration cache older than 30 days. Health check `ai-assistant` (degraded when live has no key, mock outside dev, or the token cap is reached).

## Disable

Remove `ai-assistant` from `modules.config*.ts`, run `modules:sync`, and drop `<AssistantDrawer />` from the layout. Nothing else depends on it (planting may call `narrate` only when `registry.has('ai-assistant')`).
