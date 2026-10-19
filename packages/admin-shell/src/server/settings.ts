import { audit, listAudit } from '@ecomkit/core/audit';
import { ForbiddenError, requirePermission } from '@ecomkit/core/auth-context';
import type { ModuleSettings, Permission, SettingsActionResult, StaffViewer } from '@ecomkit/core/contracts';
import { env } from '@ecomkit/core/env';
import type { Registry } from '@ecomkit/core/manifest';
import { captureError } from '@ecomkit/core/observability';
import { defineSettings, getSettingsForAdmin, setSettings } from '@ecomkit/core/settings';
import type { ComponentType } from 'react';
import { z } from 'zod';
import {
  absoluteUrl,
  describeSettings,
  formToPatch,
  humanize,
  safeRedirect,
  settingsUrls,
  type FormState,
  type SettingsField,
} from '../domain';
import { failure, NO_ACCESS, requestMeta } from './access';

const moduleIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export interface SettingsFieldView extends SettingsField {
  /** Stored value, else the schema default. Never set for secrets. */
  value?: unknown;
  /** Secrets only: `••••1234` (last 4) or '' when not configured. */
  masked?: string;
  configured?: boolean;
}

export interface SettingsActionView {
  id: string;
  label: string;
  kind: 'server-action' | 'oauth-redirect' | 'test-connection';
  allowed: boolean;
  last: { at: string; ok: boolean; message: string } | null;
}

export interface SettingsView {
  moduleId: string;
  title: string;
  fields: SettingsFieldView[];
  actions: SettingsActionView[];
  urls: { label: string; url: string; help?: string }[];
  canWrite: boolean;
  canWriteSecrets: boolean;
  Panel: ComponentType<{ moduleId: string }> | null;
}

function findSettings(registry: Registry, moduleId: string): ModuleSettings | null {
  if (!moduleIdSchema.safeParse(moduleId).success) return null;
  return registry.settings.find((s) => s.moduleId === moduleId)?.settings ?? null;
}

/** Settings page title: the module's own nav label for /admin/settings/<id>, else its id in words. */
export function settingsTitle(registry: Registry, moduleId: string): string {
  return registry.nav.find((n) => n.href === `/admin/settings/${moduleId}`)?.label ?? humanize(moduleId);
}

/** Modules with settings, for /admin/settings. */
export function settingsIndex(registry: Registry): { moduleId: string; title: string; href: string; groups: string[] }[] {
  return registry.settings
    .map(({ moduleId, settings }) => ({
      moduleId,
      title: settingsTitle(registry, moduleId),
      href: `/admin/settings/${moduleId}`,
      groups: [...new Set(describeSettings(settings.schema).map((f) => f.group))],
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

const has = (viewer: StaffViewer, p: Permission) => viewer.permissions.includes(p);
const actionEntity = 'settings_action';

/**
 * Everything the settings page renders for one module. Contains no decrypted secret: secret fields carry only
 * `maskSecret` output from core. Null when the module has no settings (the page 404s).
 */
export async function loadSettingsView(registry: Registry, moduleId: string, viewer: StaffViewer): Promise<SettingsView | null> {
  const settings = findSettings(registry, moduleId);
  if (!settings) return null;
  const def = defineSettings(moduleId, settings.schema);
  const stored = await getSettingsForAdmin(def);
  const fields = describeSettings(settings.schema).map((f): SettingsFieldView => {
    if (f.kind === 'secret') return { ...f, masked: stored.secrets[f.key]?.masked ?? '', configured: stored.secrets[f.key]?.configured ?? false };
    return { ...f, value: f.key in stored.values ? stored.values[f.key] : f.defaultValue };
  });
  const actions = await Promise.all(
    (settings.actions ?? []).map(async (a): Promise<SettingsActionView> => {
      const [row] = await listAudit({ entity: actionEntity, entityId: `${moduleId}:${a.id}`, limit: 1 });
      const after = (row?.after ?? null) as { ok?: boolean; message?: string } | null;
      return {
        id: a.id,
        label: a.label,
        kind: a.kind,
        allowed: has(viewer, a.permission ?? 'settings.write'),
        last: row ? { at: row.createdAt.toISOString(), ok: !!after?.ok, message: String(after?.message ?? '') } : null,
      };
    }),
  );
  const origin = env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? null;
  return {
    moduleId,
    title: settingsTitle(registry, moduleId),
    fields,
    actions,
    urls: settingsUrls(registry.get(moduleId)).map((u) => ({ label: u.label, url: absoluteUrl(u.path, origin), ...(u.help ? { help: u.help } : {}) })),
    canWrite: has(viewer, 'settings.write'),
    canWriteSecrets: has(viewer, 'settings.secrets'),
    Panel: settings.customPanel ? await settings.customPanel() : null,
  };
}

/** Server action body for the generated form: settings.write to save, settings.secrets to change a secret. */
export async function saveSettings(registry: Registry, moduleId: string, form: FormData): Promise<FormState> {
  const settings = findSettings(registry, moduleId);
  if (!settings) return { ok: false, message: 'These settings do not exist.' };
  try {
    const viewer = await requirePermission('settings.write');
    const fields = describeSettings(settings.schema);
    const { patch, fieldErrors } = formToPatch(fields, form, { canWriteSecrets: has(viewer, 'settings.secrets') });
    if (Object.keys(fieldErrors).length) return { ok: false, message: 'Check the highlighted fields.', fieldErrors };
    const { ipHash } = await requestMeta();
    await setSettings(defineSettings(moduleId, settings.schema), patch, { actorId: viewer.userId, ipHash });
    return { ok: true, message: 'Settings saved.' };
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, message: NO_ACCESS };
    return failure(err, `/admin/settings/${moduleId}`);
  }
}

export interface ActionOutcome {
  ok: boolean;
  message: string;
  /** oauth-redirect only: where the browser goes next (https or a same-origin path). */
  redirectUrl?: string;
}

const resultSchema = z.object({ ok: z.boolean(), message: z.string().max(500), redirectUrl: z.string().optional() });

/**
 * Runs one `settings.actions[]` entry: checks its permission (default settings.write), calls it, validates the
 * result, audits the outcome (which is also the "last run" shown on the page) and returns it for a toast.
 */
export async function runSettingsAction(registry: Registry, moduleId: string, actionId: string): Promise<ActionOutcome> {
  const action = findSettings(registry, moduleId)?.actions?.find((a) => a.id === actionId);
  if (!action) return { ok: false, message: 'This action does not exist.' };
  let viewer: StaffViewer;
  try {
    viewer = await requirePermission(action.permission ?? 'settings.write');
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, message: NO_ACCESS };
    throw err;
  }
  let outcome: ActionOutcome;
  try {
    const run = await action.run();
    const parsed = resultSchema.safeParse((await run({ moduleId, actorId: viewer.userId })) satisfies SettingsActionResult);
    if (!parsed.success) throw new TypeError(`settings action ${moduleId}:${actionId} returned an invalid result`);
    outcome = { ok: parsed.data.ok, message: parsed.data.message };
    if (action.kind === 'oauth-redirect' && parsed.data.ok) {
      const target = safeRedirect(parsed.data.redirectUrl);
      outcome = target ? { ...outcome, redirectUrl: target } : { ok: false, message: 'The connect link is not a secure address.' };
    }
  } catch (err) {
    await captureError(err, { route: `/admin/settings/${moduleId}` });
    outcome = { ok: false, message: `${action.label} failed. Details are under Health.` };
  }
  const { ipHash } = await requestMeta();
  await audit({
    actorId: viewer.userId,
    actorType: 'staff',
    action: 'settings.action',
    entity: actionEntity,
    entityId: `${moduleId}:${actionId}`,
    after: { ok: outcome.ok, message: outcome.message },
    ipHash,
  });
  return outcome;
}
