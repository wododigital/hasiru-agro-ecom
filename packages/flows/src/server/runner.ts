import type { TemplateKey } from '@ecomkit/core/contracts';
import { db, withTx, type Tx } from '@ecomkit/core/db';
import { env } from '@ecomkit/core/env';
import { hashContact, signInternal, timingSafeEqual } from '@ecomkit/core/http';
import { newId } from '@ecomkit/core/ids';
import { formatINR } from '@ecomkit/core/money';
import { hasConsent } from '@ecomkit/customers/server';
import { lastInboundAt, send } from '@ecomkit/notifications/server';
import { and, asc, count, eq, gt, inArray, isNull, lte, notInArray, or, sql } from 'drizzle-orm';
import { dueAt, FLOW_DEFS, type FlowDef, type FlowKey, type StepConfig, type StopReason } from '../domain';
import { flowsMessages } from '../messages';
import { flowsFlow, flowsRun, flowsRunStep, flowsStep } from '../schema';
import { getFlowRow } from './flows';
import { flowPorts, type Contact } from './ports';

export type RunRow = typeof flowsRun.$inferSelect;
type RunLike = Pick<RunRow, 'id' | 'subjectType' | 'subjectId' | 'context' | 'startedAt'>;

/** Stop reasons decided at start: those runs never messaged anyone and do not count toward the 7-day cap. */
const START_STOPS: StopReason[] = ['no_contact', 'no_consent', 'frequency_cap', 'subject_missing'];
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const RESTORE_PURPOSE = 'flows-restore';

export const siteUrl = (): string => (env.SITE_URL ?? env.INTERNAL_BASE_URL).replace(/\/$/, '');
const absolute = (href: string) => (/^https?:\/\//.test(href) ? href : `${siteUrl()}${href.startsWith('/') ? '' : '/'}${href}`);

// ---- restore link -----------------------------------------------------------------------------
const restoreSig = (runId: string) => signInternal(runId, RESTORE_PURPOSE).slice(0, 32);
export const restoreToken = (runId: string): string => `${runId}.${restoreSig(runId)}`;
/** The run id inside a valid token, else null. */
export function verifyRestoreToken(token: string): string | null {
  const [runId, sig] = token.split('.');
  if (!runId || !sig || !/^[0-9a-f-]{36}$/.test(runId)) return null;
  return timingSafeEqual(restoreSig(runId), sig) ? runId : null;
}

// ---- subjects ---------------------------------------------------------------------------------
interface Resolved {
  contact: Contact | null;
  vars: Record<string, string>;
  stop: StopReason | null;
  isTest: boolean;
  orderId: string | null;
}
const missing = (): Resolved => ({ contact: null, vars: {}, stop: 'subject_missing', isTest: false, orderId: null });
const nameOf = (c: Contact | null) => c?.name?.trim() || flowsMessages.fallbackName;

/** Reads the subject fresh from its owning module (through the ports) and builds the template variables. */
async function resolveSubject(run: RunLike, def: FlowDef, inline?: Contact): Promise<Resolved> {
  const ports = flowPorts();
  const ctx = run.context;
  if (run.subjectType === 'cart') {
    const snap = ctx.cartId && ports.carts ? await ports.carts.snapshot(ctx.cartId, ctx.checkoutSessionId ?? null) : null;
    if (!snap) return missing();
    return {
      contact: snap.contact,
      vars: { name: nameOf(snap.contact), cart_link: `${siteUrl()}/r/${restoreToken(run.id)}` },
      stop: snap.status === 'converted' ? 'purchased' : null,
      isTest: false,
      orderId: null,
    };
  }
  if (run.subjectType === 'order') {
    const o = ctx.orderId && ports.orders ? await ports.orders.summary(ctx.orderId) : null;
    if (!o) return missing();
    const cancelled = def.key !== 'order_updates' && ['cancelled', 'refunded'].includes(o.status);
    return {
      contact: o.contact,
      vars: {
        name: nameOf(o.contact),
        order_number: o.number,
        total: formatINR(o.totalPaise),
        order_link: o.link,
        delivery_date: o.deliveryDate ?? flowsMessages.dateToBeConfirmed,
        slot_date: o.deliveryDate ?? ctx.slotDate ?? flowsMessages.dateToBeConfirmed,
        slot_window: o.slotWindow ?? flowsMessages.anyTimeOfDay,
        review_link: `${siteUrl()}/account/reviews`,
      },
      stop: cancelled ? 'order_cancelled' : null,
      isTest: o.isTest,
      orderId: ctx.orderId!,
    };
  }
  if (run.subjectType === 'lead') {
    const lead = ctx.leadId && ports.leads ? await ports.leads.get(ctx.leadId) : null;
    if (!lead) return missing();
    return { contact: lead, vars: { name: nameOf(lead), link: lead.link ? absolute(lead.link) : siteUrl() }, stop: null, isTest: false, orderId: null };
  }
  // 'direct': the caller passed the contact in (back in stock); it is never stored, so a later step has none.
  const label = ctx.productId && ports.products ? await ports.products.label(ctx.productId) : null;
  return {
    contact: inline ?? null,
    vars: { name: nameOf(inline ?? null), product_name: label?.name ?? flowsMessages.fallbackProduct, product_link: label ? absolute(label.href) : siteUrl() },
    stop: null,
    isTest: false,
    orderId: null,
  };
}

/** Marketing consent from the single consent store (customers). An unparseable identifier means no consent. */
async function marketingConsent(c: Contact): Promise<boolean> {
  try {
    return await hasConsent({ userId: c.customerId ?? null, phone: c.phone ?? null, email: c.email ?? null }, 'marketing');
  } catch {
    return false;
  }
}

async function stopCheck(run: RunLike, def: FlowDef, r: Resolved): Promise<StopReason | null> {
  if (r.stop) return r.stop;
  const c = r.contact;
  if (!c) return 'subject_missing';
  const orders = flowPorts().orders;
  if (def.stopOnPurchase && orders && (await orders.hasOrderSince(c, run.startedAt))) return 'purchased';
  if (def.stopOnReply && c.phone) {
    const at = await lastInboundAt(c.phone);
    if (at && at > run.startedAt) return 'replied';
  }
  if (def.needsConsent && !(await marketingConsent(c))) return 'unsubscribed';
  return null;
}

const contactHashOf = (c: Contact | null) => hashContact(c?.phone) ?? hashContact(c?.email);

// ---- engine -----------------------------------------------------------------------------------
export interface AdvanceResult {
  status: RunRow['status'];
  messageIds: string[];
}

async function stopRun(tx: Tx, run: RunRow, reason: StopReason, now: Date, stepId: string, messageIds: string[]): Promise<AdvanceResult> {
  await tx.insert(flowsRunStep).values({ runId: run.id, stepId, executedAt: now, result: { stop: reason } });
  await tx
    .update(flowsRun)
    .set({ status: 'stopped', stopReason: reason, nextStepAt: null, messages: run.messages + messageIds.length, updatedAt: now })
    .where(eq(flowsRun.id, run.id));
  return { status: 'stopped', messageIds };
}

/**
 * Executes a running run's steps from its position: waits park it (next_step_at, quiet hours applied), stop_if
 * ends it, sends queue messages through notifications in the same transaction (nothing is sent for a rolled-back
 * step). Returns null when the run is not running or another worker holds it.
 */
export async function advance(runId: string, options: { now?: Date; contact?: Contact } = {}): Promise<AdvanceResult | null> {
  const now = options.now ?? new Date();
  return withTx(async (tx) => {
    const [run] = await tx
      .select()
      .from(flowsRun)
      .where(and(eq(flowsRun.id, runId), eq(flowsRun.status, 'running')))
      .for('update', { skipLocked: true });
    if (!run) return null;
    const [flow] = await tx.select({ key: flowsFlow.key }).from(flowsFlow).where(eq(flowsFlow.id, run.flowId));
    const { key, settings } = await getFlowRow(flow!.key as FlowKey, tx);
    const def = FLOW_DEFS[key];
    const steps = await tx.select().from(flowsStep).where(eq(flowsStep.flowId, run.flowId)).orderBy(asc(flowsStep.position));
    const context = { ...run.context };
    let resolved: Resolved | null = null;
    const get = async () => (resolved ??= await resolveSubject(run, def, options.contact));
    const messageIds: string[] = [];

    for (const step of steps) {
      if (step.position < run.position) continue;
      const cfg = step.config as StepConfig;
      if (!cfg.enabled || (context.only !== undefined && String(cfg.stage) !== context.only)) continue;
      if (step.kind === 'wait') {
        const due = dueAt(run.startedAt, cfg.minutes ?? 0, settings.quietHours);
        if (due > now) {
          await tx
            .update(flowsRun)
            .set({ position: step.position + 1, nextStepAt: due, context, messages: run.messages + messageIds.length, updatedAt: now })
            .where(eq(flowsRun.id, run.id));
          return { status: 'running' as const, messageIds };
        }
        continue;
      }
      const r = await get();
      if (step.kind === 'stop_if') {
        const reason = await stopCheck(run, def, r);
        if (reason) return stopRun(tx, run, reason, now, step.id, messageIds);
        continue;
      }
      const channel = step.kind === 'send_email' ? 'email' : 'whatsapp';
      const address = channel === 'email' ? r.contact?.email : r.contact?.phone;
      if (!address) {
        await tx.insert(flowsRunStep).values({ runId: run.id, stepId: step.id, executedAt: now, result: { skipped: 'no_address', channel } });
        continue;
      }
      const vars = { ...r.vars };
      const ports = flowPorts();
      if (cfg.offer && settings.discountRuleId && ports.discounts && r.contact?.phone) {
        // One code per run, bound to the phone; the restore link applies it to the cart.
        context.code ??= await ports.discounts.createSingleUseCode({ ruleId: settings.discountRuleId, phone: r.contact.phone, expiresAt: new Date(now.getTime() + settings.codeValidHours * 3_600_000) });
        vars.code = context.code;
      }
      const sent = await send(
        cfg.templateKey as TemplateKey,
        { customerId: r.contact?.customerId ?? null, phone: r.contact?.phone ?? null, email: r.contact?.email ?? null },
        vars,
        { channel, tx, flowRunId: run.id, orderId: r.orderId, isTest: run.isTest || r.isTest, now },
      );
      messageIds.push(...sent.messageIds);
      await tx.insert(flowsRunStep).values({ runId: run.id, stepId: step.id, executedAt: now, result: { sent: sent.messageIds, channel, templateKey: cfg.templateKey } });
    }
    await tx
      .update(flowsRun)
      .set({ status: 'completed', position: steps.length, nextStepAt: null, context, messages: run.messages + messageIds.length, updatedAt: now })
      .where(eq(flowsRun.id, run.id));
    return { status: 'completed' as const, messageIds };
  });
}

/** `advance` that records a failure on the run instead of throwing (bad template data, a port error). */
async function advanceSafe(runId: string, options: { now?: Date; contact?: Contact } = {}): Promise<AdvanceResult | null> {
  try {
    return await advance(runId, options);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(flowsRun)
      .set({ status: 'failed', stopReason: `error: ${message}`.slice(0, 500), nextStepAt: null, updatedAt: new Date() })
      .where(and(eq(flowsRun.id, runId), eq(flowsRun.status, 'running')));
    return { status: 'failed', messageIds: [] };
  }
}

export interface StartOptions {
  now?: Date;
  /** Contact for a 'direct' subject (used in this call only, never stored). */
  contact?: Contact;
  /** Start at most one run per subject ever (order stages, review requests, lead follow-ups). */
  once?: boolean;
}

/**
 * Starts a flow for a subject. Paused flows start nothing. Start checks (no contact, no marketing consent for
 * marketing flows, the 7-day cap per contact) record a stopped run with zero messages; otherwise the run starts
 * and runs at once up to its first wait. At most one running run per (flow, subject).
 */
export async function startFlow(
  key: FlowKey,
  subject: { type: 'cart' | 'order' | 'lead' | 'direct'; id: string },
  context: Record<string, string>,
  options: StartOptions = {},
): Promise<{ run: RunRow; messageIds: string[] } | null> {
  const now = options.now ?? new Date();
  const flow = await getFlowRow(key);
  if (flow.status !== 'active') return null;
  // A subject already in this flow (running, or ever when `once`) starts nothing new.
  const [existing] = await db
    .select({ id: flowsRun.id })
    .from(flowsRun)
    .where(and(eq(flowsRun.flowId, flow.id), eq(flowsRun.subjectType, subject.type), eq(flowsRun.subjectId, subject.id), options.once ? undefined : eq(flowsRun.status, 'running')))
    .limit(1);
  if (existing) return null;
  const def = FLOW_DEFS[key];
  const id = newId();
  const r = await resolveSubject({ id, subjectType: subject.type, subjectId: subject.id, context, startedAt: now }, def, options.contact);
  let stop: StopReason | null = r.stop;
  if (!stop && !r.contact?.phone && !r.contact?.email) stop = 'no_contact';
  if (!stop && def.needsConsent && !(await marketingConsent(r.contact!))) stop = 'no_consent';
  const contactHash = contactHashOf(r.contact);

  const run = await withTx(async (tx) => {
    if (!stop && contactHash && flow.settings.maxPer7Days > 0) {
      // Serialise starts per contact so two carts abandoned together cannot both pass the cap.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`flows:${contactHash}`}))`);
      const [recent] = await tx
        .select({ n: count() })
        .from(flowsRun)
        .where(
          and(
            eq(flowsRun.flowId, flow.id),
            eq(flowsRun.contactHash, contactHash),
            eq(flowsRun.isTest, false),
            gt(flowsRun.startedAt, new Date(now.getTime() - WEEK_MS)),
            or(isNull(flowsRun.stopReason), notInArray(flowsRun.stopReason, START_STOPS)),
          ),
        );
      if (recent!.n >= flow.settings.maxPer7Days) stop = 'frequency_cap';
    }
    const [row] = await tx
      .insert(flowsRun)
      .values({
        id,
        flowId: flow.id,
        subjectType: subject.type,
        subjectId: subject.id,
        contactHash,
        context,
        status: stop ? 'stopped' : 'running',
        stopReason: stop,
        nextStepAt: stop ? null : now,
        isTest: r.isTest,
        startedAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();
    return row ?? null;
  });
  if (!run) return null;
  if (run.status !== 'running') return { run, messageIds: [] };
  const result = await advanceSafe(run.id, { now, ...(options.contact ? { contact: options.contact } : {}) });
  const [fresh] = await db.select().from(flowsRun).where(eq(flowsRun.id, run.id));
  return { run: fresh!, messageIds: result?.messageIds ?? [] };
}

/** Job `flows.run-due`: advances every running run whose next step is due. Returns how many were advanced. */
export async function runDue(now: Date = new Date(), limit = 200): Promise<number> {
  const due = await db
    .select({ id: flowsRun.id })
    .from(flowsRun)
    .where(and(eq(flowsRun.status, 'running'), lte(flowsRun.nextStepAt, now)))
    .orderBy(asc(flowsRun.nextStepAt))
    .limit(limit);
  for (const { id } of due) await advanceSafe(id, { now });
  return due.length;
}

export const runDueJob = async (): Promise<void> => {
  await runDue();
};

/** Ends running purchase-sensitive runs (abandoned cart, lead follow-up) for any of these contacts. */
export async function stopRunsForContacts(contacts: Contact[], reason: StopReason, now: Date = new Date()): Promise<number> {
  const hashes = contacts.flatMap((c) => [hashContact(c.phone), hashContact(c.email)]).filter((h): h is string => !!h);
  if (!hashes.length) return 0;
  const keys = (Object.keys(FLOW_DEFS) as FlowKey[]).filter((k) => FLOW_DEFS[k].stopOnPurchase);
  const flowIds = (await db.select({ id: flowsFlow.id }).from(flowsFlow).where(inArray(flowsFlow.key, keys))).map((f) => f.id);
  if (!flowIds.length) return 0;
  const stopped = await db
    .update(flowsRun)
    .set({ status: 'stopped', stopReason: reason, nextStepAt: null, updatedAt: now })
    .where(and(eq(flowsRun.status, 'running'), inArray(flowsRun.flowId, flowIds), inArray(flowsRun.contactHash, hashes)))
    .returning({ id: flowsRun.id });
  return stopped.length;
}
