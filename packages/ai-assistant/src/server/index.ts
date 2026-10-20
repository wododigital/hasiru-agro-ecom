import 'server-only';

// Public server API (BUILD-PLAN 2.5): answer(question, ctx), narrate(facts), the stream route handler, transcripts.
export { configureAssistant, assistantRuntime, type AssistantRegistry, type AssistantRuntimeInput, type CompanionSource } from './runtime';
export { buildFacts, loadCatalogItems, catalogCompanions } from './facts';
export { narrate, monthTokens, istMonthStart, narrationCacheKey, INTEGRATION, type NarrationResult, type FallbackReason, type HistoryTurn } from './narrate';
export { answer, handleAssistantPost, chipsFor, STREAM_PATH, type AnswerResult } from './answer';
export { startOrResume, historyFor, logTurn, tokensToNames, listConversations, getConversation, usageSince, pruneTranscripts, type ConversationListRow } from './transcripts';
export { testConnectionAction, assistantHealth, pruneJob, TEST_FACTS } from './actions';
export { assistantSettings, assistantSettingsSchema, type AssistantSettings } from '../settings';
