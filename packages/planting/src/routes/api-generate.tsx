import { handleGenerate } from '../server/handlers';

/** POST /api/plan/generate: wizard answers (JSON or a plain form post) -> a new plan. */
export const POST = handleGenerate;
