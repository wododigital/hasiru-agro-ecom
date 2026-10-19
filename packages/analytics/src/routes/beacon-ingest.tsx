import { createBeaconIngest } from '../server/http';

/**
 * POST /api/beacon-ingest without a consent lookup: visitors are never linked to customers.
 * A host that has the customers module wires `hasConsent` in its own route file (see README).
 */
export const POST = createBeaconIngest();
