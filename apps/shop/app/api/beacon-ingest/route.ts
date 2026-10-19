import { createBeaconIngest } from '@ecomkit/analytics/server';

// Hand-written so the store can wire the customers consent lookup here. Until the customers module exports one,
// no consent lookup is passed and visitors are never linked to customers (fail closed).
export const POST = createBeaconIngest();
