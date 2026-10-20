import { handleUnlock } from '../server/handlers';

/** POST /api/plan/unlock: soft unlock, or send / verify a code (otp mode). */
export const POST = handleUnlock;
