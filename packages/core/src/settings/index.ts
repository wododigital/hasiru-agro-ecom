import { and, eq, inArray } from 'drizzle-orm';
import * as React from 'react';
import type { z, ZodObject, ZodRawShape, ZodType } from 'zod';
import type { ModuleId } from '../contracts';
import { audit } from '../audit';
import { tags, invalidateTags } from '../cache-tags';
import { withTx, type DbOrTx, db, upsertRequireUpdate } from '../db';
import { coreSettings } from '../schema';
import { seal, unseal, type SealedSecret } from './crypto';

export interface SettingsDef<Shape extends ZodRawShape = ZodRawShape> {
  moduleId: ModuleId;
  schema: ZodObject<Shape>;
  /** Field names marked `.meta({ secret: true })`. */
  secretKeys: readonly string[];
}

export interface FieldMeta {
  secret?: boolean;
  group?: string;
  help?: string;
  placeholder?: string;
}

/** The schema and its optional/default/nullable wrappers, outermost first. */
function layers(schema: ZodType): ZodType[] {
  const out: ZodType[] = [];
  for (let s: ZodType | undefined = schema; s && out.length < 8; ) {
    out.push(s);
    s = (s as unknown as { def?: { innerType?: ZodType } }).def?.innerType;
  }
  return out;
}

/** Meta of a field, looking through optional/default/nullable wrappers (zod keeps meta on the schema it was set on). */
export function fieldMeta(schema: ZodType): FieldMeta {
  const merged: FieldMeta = {};
  for (const s of layers(schema)) Object.assign(merged, { ...(s.meta() as FieldMeta | undefined), ...merged });
  return merged;
}

/** Declares a module's settings. Put the result's `schema` in the manifest `settings.schema`. */
export function defineSettings<Shape extends ZodRawShape>(moduleId: ModuleId, schema: ZodObject<Shape>): SettingsDef<Shape> {
  const secretKeys = Object.entries(schema.shape)
    .filter(([, field]) => fieldMeta(field as ZodType).secret)
    .map(([key]) => key);
  for (const key of secretKeys) {
    const base = layers(schema.shape[key] as ZodType).at(-1) as unknown as { def: { type: string } };
    if (base.def.type !== 'string') throw new Error(`${moduleId}.${key}: secret settings must be strings`);
  }
  return { moduleId, schema, secretKeys };
}

/** `••••1234`: the only form a secret ever leaves the server in. */
export function maskSecret(value: string | null | undefined): string {
  if (!value) return '';
  return `••••${value.length > 8 ? value.slice(-4) : ''}`;
}

type Taint = (message: string, lifetime: object, value: string) => void;
const taint = (React as unknown as { experimental_taintUniqueValue?: Taint }).experimental_taintUniqueValue;

async function readRows(moduleId: ModuleId, dbOrTx: DbOrTx = db) {
  return dbOrTx.select().from(coreSettings).where(eq(coreSettings.module, moduleId));
}

/**
 * Stored values, secrets decrypted, defaults applied, parsed by the schema. Server only.
 * Decrypted secrets are tainted (React server builds), so passing one to a client component throws.
 */
export async function getSettings<Shape extends ZodRawShape>(def: SettingsDef<Shape>, dbOrTx?: DbOrTx): Promise<z.infer<ZodObject<Shape>>> {
  const raw: Record<string, unknown> = {};
  for (const row of await readRows(def.moduleId, dbOrTx)) {
    if (row.isSecret) {
      const plain = unseal(def.moduleId, row.key, row.value as SealedSecret);
      taint?.('A settings secret must not be sent to the client', globalThis, plain);
      raw[row.key] = plain;
    } else raw[row.key] = row.value;
  }
  return def.schema.parse(raw) as z.infer<ZodObject<Shape>>;
}

/** For the admin form: secrets replaced by `maskSecret` and a `configured` flag. Never contains a decrypted secret. */
export async function getSettingsForAdmin(def: SettingsDef): Promise<{ values: Record<string, unknown>; secrets: Record<string, { configured: boolean; masked: string }> }> {
  const values: Record<string, unknown> = {};
  const secrets: Record<string, { configured: boolean; masked: string }> = {};
  for (const key of def.secretKeys) secrets[key] = { configured: false, masked: '' };
  for (const row of await readRows(def.moduleId)) {
    if (row.isSecret) secrets[row.key] = { configured: true, masked: maskSecret(unseal(def.moduleId, row.key, row.value as SealedSecret)) };
    else values[row.key] = row.value;
  }
  return { values, secrets };
}

export interface SetSettingsContext {
  actorId: string | null;
  actorType?: 'staff' | 'system';
  ipHash?: string | null;
}

/**
 * Validates and stores a partial update. Secret fields: a non-empty string replaces the value, `null`
 * clears it, an absent or empty field keeps it (the admin form never round-trips a secret).
 * Writes one audit row (secrets masked) and invalidates the `settings:<module>` tag.
 */
export async function setSettings(def: SettingsDef, patch: Record<string, unknown>, ctx: SetSettingsContext): Promise<void> {
  const secretSet = new Set(def.secretKeys);
  const cleaned: Record<string, unknown> = {};
  const clear: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in def.schema.shape)) throw new Error(`${def.moduleId}: unknown setting "${key}"`);
    if (secretSet.has(key) && (value === undefined || value === '')) continue;
    if (secretSet.has(key) && value === null) clear.push(key);
    else cleaned[key] = value;
  }
  // zod 4 fills defaults for absent keys even through `.partial()`; keep only the keys the patch carried, or a
  // partial update would reset every other defaulted field.
  const parsed = Object.fromEntries(Object.entries(def.schema.partial().parse(cleaned) as Record<string, unknown>).filter(([k]) => k in cleaned));

  await withTx(async (tx) => {
    const before = await getSettingsForAdmin(def);
    for (const [key, value] of Object.entries(parsed)) {
      if (value === undefined) continue;
      const isSecret = secretSet.has(key);
      const stored = isSecret ? seal(def.moduleId, key, String(value)) : value;
      const row = { module: def.moduleId, key, value: stored, isSecret, keyVersion: isSecret ? (stored as SealedSecret).v : null, updatedBy: ctx.actorId };
      await upsertRequireUpdate(tx, coreSettings, row, {
        target: [coreSettings.module, coreSettings.key],
        set: { value: row.value, isSecret, keyVersion: row.keyVersion, updatedBy: ctx.actorId, updatedAt: new Date() },
      });
    }
    if (clear.length) await tx.delete(coreSettings).where(and(eq(coreSettings.module, def.moduleId), inArray(coreSettings.key, clear)));
    const changedSecrets = Object.fromEntries([...Object.keys(parsed), ...clear].filter((k) => secretSet.has(k)).map((k) => [k, clear.includes(k) ? 'cleared' : 'replaced']));
    await audit(
      {
        actorId: ctx.actorId,
        actorType: ctx.actorType ?? 'staff',
        action: 'settings.update',
        entity: 'settings',
        entityId: def.moduleId,
        before: before.values,
        after: { ...Object.fromEntries(Object.entries(parsed).filter(([k]) => !secretSet.has(k))), ...(Object.keys(changedSecrets).length ? { secrets: changedSecrets } : {}) },
        ipHash: ctx.ipHash ?? null,
      },
      { tx },
    );
  });
  await invalidateTags([tags.settings(def.moduleId)]);
}
