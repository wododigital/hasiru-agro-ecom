import type { ZodObject, ZodType } from 'zod';

/**
 * Turns a module's settings zod schema into form fields, and a submitted form back into a settings patch.
 * Pure: the server layer stores the patch with core `setSettings`, which validates it again with the same schema.
 */

export type FieldKind = 'text' | 'email' | 'url' | 'number' | 'boolean' | 'select' | 'multiselect' | 'lines' | 'secret' | 'readonly';

export interface SettingsField {
  key: string;
  label: string;
  kind: FieldKind;
  group: string;
  help?: string;
  placeholder?: string;
  options?: readonly string[];
  /** The schema rejects an empty value (no optional, nullable or default wrapper). */
  required: boolean;
  integer?: boolean;
  /** Value shown when nothing is stored (the schema default). */
  defaultValue?: unknown;
}

interface Def {
  type: string;
  innerType?: ZodType;
  format?: string;
  entries?: Record<string, string | number>;
  element?: ZodType;
}
const defOf = (s: ZodType) => (s as unknown as { def: Def }).def;

/** The schema and its optional/default/nullable wrappers, outermost first. */
function layers(schema: ZodType): ZodType[] {
  const out: ZodType[] = [];
  for (let s: ZodType | undefined = schema; s && out.length < 8; s = defOf(s).innerType) out.push(s);
  return out;
}

interface Meta {
  secret?: boolean;
  group?: string;
  help?: string;
  placeholder?: string;
  title?: string;
  description?: string;
}
/** Merged meta over the wrappers; the outermost value wins (zod keeps meta on the schema it was set on). */
function metaOf(schema: ZodType): Meta {
  const merged: Meta = {};
  for (const s of layers(schema)) {
    const m = (s.meta() ?? {}) as Meta;
    for (const [k, v] of Object.entries(m)) if (!(k in merged)) (merged as Record<string, unknown>)[k] = v;
  }
  return merged;
}

/** `advancePct` -> `Advance pct`, `gstin_number` -> `Gstin number`. */
export function humanize(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function kindOf(base: ZodType, secret: boolean): Pick<SettingsField, 'kind' | 'options' | 'integer'> {
  if (secret) return { kind: 'secret' };
  const def = defOf(base);
  switch (def.type) {
    case 'string':
      return { kind: def.format === 'email' ? 'email' : def.format === 'url' ? 'url' : 'text' };
    case 'number':
      return { kind: 'number', integer: def.format === 'safeint' || def.format === 'int32' };
    case 'boolean':
      return { kind: 'boolean' };
    case 'enum':
      return { kind: 'select', options: Object.values(def.entries ?? {}).map(String) };
    case 'array': {
      const el = layers(def.element!).at(-1)!;
      const elDef = defOf(el);
      if (elDef.type === 'enum') return { kind: 'multiselect', options: Object.values(elDef.entries ?? {}).map(String) };
      if (elDef.type === 'string') return { kind: 'lines' };
      return { kind: 'readonly' };
    }
    default:
      // Objects, unions, records: edited by the module's custom panel, shown read-only here.
      return { kind: 'readonly' };
  }
}

export function describeSettings(schema: ZodObject): SettingsField[] {
  return Object.entries(schema.shape).map(([key, raw]) => {
    const field = raw as ZodType;
    const meta = metaOf(field);
    const base = layers(field).at(-1)!;
    const fallback = field.safeParse(undefined);
    return {
      key,
      label: meta.title ?? humanize(key),
      group: meta.group ?? 'General',
      ...(meta.help || meta.description ? { help: meta.help ?? meta.description } : {}),
      ...(meta.placeholder ? { placeholder: meta.placeholder } : {}),
      ...kindOf(base, !!meta.secret),
      required: !fallback.success,
      ...(fallback.success && fallback.data !== undefined ? { defaultValue: fallback.data } : {}),
    };
  });
}

/** Fields grouped by `meta.group`, groups in order of first appearance. */
export function groupFields<F extends { group: string }>(fields: readonly F[]): { group: string; fields: F[] }[] {
  const groups = new Map<string, F[]>();
  for (const f of fields) groups.set(f.group, [...(groups.get(f.group) ?? []), f]);
  return [...groups].map(([group, list]) => ({ group, fields: list }));
}

export interface PatchResult {
  patch: Record<string, unknown>;
  fieldErrors: Record<string, string[]>;
}

/**
 * Form to settings patch. Every editable field is always rendered, so an absent checkbox means false.
 * Secrets: only a non-empty value is sent (an untouched SecretField posts nothing and the stored value stays);
 * a viewer without `settings.secrets` gets a field error instead of a write.
 */
export function formToPatch(fields: readonly SettingsField[], form: FormData, options: { canWriteSecrets: boolean }): PatchResult {
  const patch: Record<string, unknown> = {};
  const fieldErrors: Record<string, string[]> = {};
  const text = (key: string) => {
    const v = form.get(key);
    return typeof v === 'string' ? v.trim() : null;
  };
  for (const f of fields) {
    switch (f.kind) {
      case 'readonly':
        break;
      case 'secret': {
        const v = text(f.key);
        if (!v) break;
        if (!options.canWriteSecrets) fieldErrors[f.key] = ['Only the store owner can change this value.'];
        else patch[f.key] = v;
        break;
      }
      case 'boolean':
        patch[f.key] = form.get(f.key) !== null;
        break;
      case 'multiselect':
        patch[f.key] = form.getAll(f.key).filter((v): v is string => typeof v === 'string');
        break;
      case 'lines':
        patch[f.key] = (text(f.key) ?? '')
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        break;
      case 'number': {
        const v = text(f.key);
        if (v === null || v === '') break; // empty keeps the stored value (or the default)
        patch[f.key] = Number.isNaN(Number(v)) ? v : Number(v);
        break;
      }
      default: {
        const v = text(f.key);
        if (v === null) break;
        // Empty plain text is stored as '' (clears it); an empty optional email/url/select keeps the stored value.
        // For a required field the schema reports the error.
        if (v === '' && !f.required && f.kind !== 'text') break;
        patch[f.key] = v;
      }
    }
  }
  return { patch, fieldErrors };
}

/** An `oauth-redirect` target must be https or a same-origin path; anything else is refused. */
export function safeRedirect(url: string | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\')) return url;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}
