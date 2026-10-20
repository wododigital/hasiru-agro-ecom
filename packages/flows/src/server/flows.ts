import { audit } from '@ecomkit/core/audit';
import { db, excluded, upsertRequireUpdate, withTx, type DbOrTx } from '@ecomkit/core/db';
import { eq } from 'drizzle-orm';
import { buildSteps, FLOW_DEFS, FLOW_KEYS, parseFlowSettings, type FlowKey, type FlowSettings } from '../domain';
import { flowsFlow, flowsStep } from '../schema';

export type FlowRow = Omit<typeof flowsFlow.$inferSelect, 'settings'> & { key: FlowKey; settings: FlowSettings };

async function writeSteps(dbOrTx: DbOrTx, flowId: string, key: FlowKey, settings: FlowSettings): Promise<void> {
  const rows = buildSteps(key, settings).map((s) => ({ flowId, position: s.position, kind: s.kind, config: s.config }));
  await upsertRequireUpdate(dbOrTx, flowsStep, rows, { target: [flowsStep.flowId, flowsStep.position], set: { kind: excluded(flowsStep.kind), config: excluded(flowsStep.config) } });
}

/** Creates any missing fixed flow with its default settings and steps. Idempotent. */
export async function ensureFlows(): Promise<void> {
  await withTx(async (tx) => {
    for (const key of FLOW_KEYS) {
      const def = FLOW_DEFS[key];
      const [row] = await tx
        .insert(flowsFlow)
        .values({ key, name: def.name, trigger: def.trigger, settings: def.defaults })
        .onConflictDoNothing({ target: flowsFlow.key })
        .returning({ id: flowsFlow.id });
      if (row) await writeSteps(tx, row.id, key, def.defaults);
    }
  });
}

export async function getFlowRow(key: FlowKey, dbOrTx: DbOrTx = db): Promise<FlowRow> {
  let [row] = await dbOrTx.select().from(flowsFlow).where(eq(flowsFlow.key, key));
  if (!row) {
    await ensureFlows();
    [row] = await dbOrTx.select().from(flowsFlow).where(eq(flowsFlow.key, key));
  }
  return { ...row!, key, settings: parseFlowSettings(key, row!.settings) };
}

/** Saves one flow's form: status and settings (validated), steps rebuilt in place, version + 1, audited. */
export async function saveFlow(key: FlowKey, input: { status: 'active' | 'paused'; settings: unknown }, actorId: string | null): Promise<FlowRow> {
  const settings = parseFlowSettings(key, input.settings);
  const before = await getFlowRow(key);
  await withTx(async (tx) => {
    await tx.update(flowsFlow).set({ status: input.status, settings, version: before.version + 1, updatedBy: actorId, updatedAt: new Date() }).where(eq(flowsFlow.id, before.id));
    await writeSteps(tx, before.id, key, settings);
    await audit(
      { actorId, actorType: actorId ? 'staff' : 'system', action: 'flow.update', entity: 'flow', entityId: before.id, before: { status: before.status, settings: before.settings }, after: { status: input.status, settings } },
      { tx },
    );
  });
  return getFlowRow(key);
}
