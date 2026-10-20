import { handleAssistantPost } from '../server';

/** POST /api/assistant/stream: the assistant's answer as NDJSON. */
export const POST = handleAssistantPost;
