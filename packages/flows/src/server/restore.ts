import { db } from '@ecomkit/core/db';
import { and, eq, sql } from 'drizzle-orm';
import { flowsRun } from '../schema';
import { flowPorts } from './ports';
import { verifyRestoreToken } from './runner';

const toCart = () => new Response(null, { status: 303, headers: { location: '/cart', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });

/**
 * GET /r/[token]: the link in abandoned-cart messages. Makes the run's cart the visitor's cart again (and applies
 * the run's single-use code), then sends them to /cart. An invalid or unknown token lands on /cart too, so the
 * response says nothing about which tokens exist.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }): Promise<Response> {
  const runId = verifyRestoreToken((await ctx.params).token);
  const carts = flowPorts().carts;
  if (!runId || !carts) return toCart();
  const [run] = await db.select().from(flowsRun).where(and(eq(flowsRun.id, runId), eq(flowsRun.subjectType, 'cart')));
  if (!run?.context.cartId) return toCart();
  await carts.restore(run.context.cartId, { couponCode: run.context.code ?? null });
  await db
    .update(flowsRun)
    .set({ context: sql`${flowsRun.context} || ${JSON.stringify({ restoredAt: new Date().toISOString() })}::jsonb` })
    .where(eq(flowsRun.id, run.id));
  return toCart();
}
