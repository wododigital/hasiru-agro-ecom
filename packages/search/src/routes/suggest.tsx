import { getSearchIndex, suggestHandler } from '../server';

/** GET /api/search/suggest?q= */
export const GET = suggestHandler(getSearchIndex);
