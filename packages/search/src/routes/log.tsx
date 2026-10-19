import { logHandler } from '../server';

/** POST /api/search/log (zero-result filter combinations, sent with sendBeacon). */
export const POST = logHandler();
