import { facetsHandler, getSearchIndex } from '../server';

/** GET /facets.json */
export const GET = facetsHandler(getSearchIndex);
