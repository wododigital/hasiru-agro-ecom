import { requirePermission } from '@ecomkit/core/auth-context';
import type { Paise, Recipient } from '@ecomkit/core/contracts';
import { db } from '@ecomkit/core/db';
import { newId } from '@ecomkit/core/ids';
import { formatINR } from '@ecomkit/core/money';
import { DEFAULT_TEMPLATES, templateVariables } from '@ecomkit/notifications/domain';
import { send } from '@ecomkit/notifications/server';
import { and, count, desc, eq, gt, sql, sum } from 'drizzle-orm';
import { FLOW_DEFS, FLOW_KEYS, type FlowKey } from '../domain';
import { flowsRun, flowsRunStep } from '../schema';
import { ensureFlows, getFlowRow, type FlowRow } from './flows';
import { flowPorts } from './ports';
import { siteUrl, type RunRow } from './runner';

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

export interface FlowCard {
  flow: FlowRow;
  description: string;
  last30: { started: number; messaged: number; stopped: number; messages: number };
}

/** Automations index: one card per fixed flow with 30-day counts (test runs excluded). */
export async function listFlowCards(options: { now?: Date } = {}): Promise<FlowCard[]> {
  await requirePermission('marketing.write');
  // The clock is read only after the request-time permission check (cache components refuse it in a prerender).
  const now = options.now ?? new Date();
  await ensureFlows();
  const since = new Date(now.getTime() - MONTH_MS);
  const flows = await Promise.all(FLOW_KEYS.map((k) => getFlowRow(k)));
  const stats = await db
    .select({
      flowId: flowsRun.flowId,
      started: count(),
      messaged: sql<number>`count(*) filter (where ${flowsRun.messages} > 0)`.mapWith(Number),
      stopped: sql<number>`count(*) filter (where ${flowsRun.status} = 'stopped')`.mapWith(Number),
      messages: sum(flowsRun.messages).mapWith(Number),
    })
    .from(flowsRun)
    .where(and(gt(flowsRun.startedAt, since), eq(flowsRun.isTest, false)))
    .groupBy(flowsRun.flowId);
  return flows.map((flow) => {
    const s = stats.find((x) => x.flowId === flow.id);
    return { flow, description: FLOW_DEFS[flow.key].description, last30: { started: s?.started ?? 0, messaged: s?.messaged ?? 0, stopped: s?.stopped ?? 0, messages: s?.messages ?? 0 } };
  });
}

/** One flow with its newest runs (the run list under the settings form). */
export async function getFlowDetail(key: FlowKey, options: { limit?: number } = {}): Promise<{ flow: FlowRow; runs: RunRow[] }> {
  await requirePermission('marketing.write');
  const flow = await getFlowRow(key);
  const runs = await db
    .select()
    .from(flowsRun)
    .where(eq(flowsRun.flowId, flow.id))
    .orderBy(desc(flowsRun.startedAt), desc(flowsRun.id))
    .limit(options.limit ?? 50);
  return { flow, runs };
}

export interface AbandonedRow {
  run: RunRow;
  valuePaise: Paise | null;
  itemCount: number | null;
}

/** /admin/abandoned-checkouts: abandoned-cart runs with cart value (from cart), messages and outcome. */
export async function listAbandonedCheckouts(options: { now?: Date; limit?: number } = {}): Promise<{ rows: AbandonedRow[]; last30: { started: number; messaged: number; recovered: number } }> {
  await requirePermission('orders.read');
  const now = options.now ?? new Date();
  const flow = await getFlowRow('abandoned_cart');
  const notTest = and(eq(flowsRun.flowId, flow.id), eq(flowsRun.isTest, false));
  const [runs, [stats]] = await Promise.all([
    db.select().from(flowsRun).where(notTest).orderBy(desc(flowsRun.startedAt), desc(flowsRun.id)).limit(options.limit ?? 50),
    db
      .select({
        started: count(),
        messaged: sql<number>`count(*) filter (where ${flowsRun.messages} > 0)`.mapWith(Number),
        recovered: sql<number>`count(*) filter (where ${flowsRun.stopReason} = 'purchased' and ${flowsRun.messages} > 0)`.mapWith(Number),
      })
      .from(flowsRun)
      .where(and(notTest, gt(flowsRun.startedAt, new Date(now.getTime() - MONTH_MS)))),
  ]);
  const carts = flowPorts().carts;
  const rows = await Promise.all(
    runs.map(async (run) => {
      const snap = carts && run.context.cartId ? await carts.snapshot(run.context.cartId, run.context.checkoutSessionId ?? null) : null;
      return { run, valuePaise: snap?.totalPaise ?? null, itemCount: snap?.itemCount ?? null };
    }),
  );
  return { rows, last30: { started: stats?.started ?? 0, messaged: stats?.messaged ?? 0, recovered: stats?.recovered ?? 0 } };
}

/** Example values for every variable a template uses, so a test send renders exactly like a real one. */
function sampleVars(templateKey: keyof typeof DEFAULT_TEMPLATES): Record<string, string> {
  const site = siteUrl();
  const known: Record<string, string> = {
    name: 'Test customer',
    order_number: 'TEST-0001',
    total: formatINR(125_000 as Paise),
    order_link: `${site}/account/orders`,
    delivery_date: 'tomorrow',
    slot_date: 'tomorrow',
    slot_window: 'morning',
    cart_link: `${site}/cart`,
    review_link: `${site}/account/reviews`,
    product_name: 'Sample item',
    product_link: site,
    link: site,
  };
  const t = DEFAULT_TEMPLATES[templateKey];
  return Object.fromEntries(templateVariables(t.subject, t.body).map((v) => [v, known[v] ?? `[${v}]`]));
}

/**
 * Sends every enabled step of a flow now, with example values, to a staff number or email (no waits, no consent
 * check, messages flagged as test). Recorded as a completed test run.
 */
export async function testRun(key: FlowKey, to: Pick<Recipient, 'phone' | 'email'>, actorId: string | null): Promise<{ runId: string; messageIds: string[] }> {
  await requirePermission('marketing.write');
  const flow = await getFlowRow(key);
  const runId = newId();
  const now = new Date();
  await db.insert(flowsRun).values({ id: runId, flowId: flow.id, subjectType: 'test', subjectId: actorId ?? runId, status: 'completed', isTest: true, startedAt: now, updatedAt: now });
  const messageIds: string[] = [];
  for (const step of flow.settings.steps.filter((s) => s.enabled)) {
    const channels = (['whatsapp', 'email'] as const).filter((c) => step.channel === 'both' || step.channel === c).filter((c) => (c === 'email' ? to.email : to.phone));
    for (const channel of channels) {
      const sent = await send(step.templateKey, { phone: to.phone ?? null, email: to.email ?? null }, sampleVars(step.templateKey), { channel, flowRunId: runId, isTest: true });
      messageIds.push(...sent.messageIds);
      await db.insert(flowsRunStep).values({ runId, result: { sent: sent.messageIds, channel, templateKey: step.templateKey, test: true } });
    }
  }
  await db.update(flowsRun).set({ messages: messageIds.length }).where(eq(flowsRun.id, runId));
  return { runId, messageIds };
}
