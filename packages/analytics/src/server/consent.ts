import type { EventHandler } from '@ecomkit/core/contracts';
import { db } from '@ecomkit/core/db';
import { eq } from 'drizzle-orm';
import { analyticsVisitor } from '../schema';

/** consent.changed: revoking analytics_identity unlinks every visitor of that customer (history stays anonymous). */
export const onConsentChanged: EventHandler<'consent.changed'> = async (payload) => {
  if (payload.purpose !== 'analytics_identity' || payload.granted || !payload.customerId) return;
  await db.update(analyticsVisitor).set({ customerId: null }).where(eq(analyticsVisitor.customerId, payload.customerId));
};
