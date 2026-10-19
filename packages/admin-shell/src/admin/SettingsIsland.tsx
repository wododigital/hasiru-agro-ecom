'use client';

import { Button, Checkbox, FormField, Input, SecretField, Select, Textarea, cn, fieldClass, toast } from '@ecomkit/ui';
import { Copy } from 'lucide-react';
import { useState, useTransition } from 'react';
import { groupFields } from '../domain/settings-form';
import type { ActionOutcome, SettingsActionView, SettingsFieldView } from '../server/settings';
import { ActionForm, type FormAction } from './ActionFormIsland';

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));

function Field({ field, error, canWriteSecrets }: { field: SettingsFieldView; error?: string; canWriteSecrets: boolean }) {
  const id = `setting-${field.key}`;
  const help = field.kind === 'secret' && !canWriteSecrets ? [field.help, 'Only the store owner can change this value.'].filter(Boolean).join(' ') : field.help;
  if (field.kind === 'boolean') {
    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="flex items-center gap-2 text-sm font-semibold text-primary">
          <Checkbox id={id} name={field.key} defaultChecked={field.value === true} aria-describedby={help ? `${id}-help` : undefined} />
          {field.label}
        </label>
        {help ? (
          <p id={`${id}-help`} className="text-xs text-muted">
            {help}
          </p>
        ) : null}
        {error ? <p className="text-xs font-medium text-danger">{error}</p> : null}
      </div>
    );
  }
  return (
    <FormField id={id} label={field.label} help={help} error={error} required={field.required}>
      {(control) => {
        switch (field.kind) {
          case 'secret':
            return canWriteSecrets ? (
              <SecretField id={id} name={field.key} masked={field.configured ? field.masked || null : null} placeholder={field.placeholder} aria-describedby={control['aria-describedby']} />
            ) : (
              <output {...control} className={cn(fieldClass, 'font-mono text-muted')}>
                {field.configured ? field.masked : 'Not set'}
              </output>
            );
          case 'number':
            return <Input {...control} type="number" name={field.key} step={field.integer ? 1 : 'any'} defaultValue={str(field.value)} placeholder={field.placeholder} />;
          case 'select':
            return (
              <Select {...control} name={field.key} defaultValue={str(field.value)}>
                {!field.required ? <option value="">Not set</option> : null}
                {field.options?.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            );
          case 'multiselect': {
            const picked = new Set(Array.isArray(field.value) ? field.value.map(String) : []);
            return (
              <fieldset {...control} className="flex flex-wrap gap-x-4 gap-y-2">
                {field.options?.map((o) => (
                  <label key={o} className="flex items-center gap-2 text-sm">
                    <Checkbox name={field.key} value={o} defaultChecked={picked.has(o)} />
                    {o}
                  </label>
                ))}
              </fieldset>
            );
          }
          case 'lines':
            return <Textarea {...control} name={field.key} defaultValue={Array.isArray(field.value) ? field.value.join('\n') : ''} placeholder={field.placeholder ?? 'One per line'} />;
          case 'readonly':
            return (
              <pre {...control} className={cn(fieldClass, 'max-h-48 overflow-auto font-mono text-xs text-muted')}>
                {JSON.stringify(field.value ?? null, null, 2)}
              </pre>
            );
          default:
            return <Input {...control} type={field.kind === 'text' ? 'text' : field.kind} name={field.key} defaultValue={str(field.value)} placeholder={field.placeholder} />;
        }
      }}
    </FormField>
  );
}

/** The generated settings form: fields from the module's zod schema, grouped by `meta.group`. */
export function SettingsFormIsland({ fields, save, canWrite, canWriteSecrets }: { fields: SettingsFieldView[]; save: FormAction; canWrite: boolean; canWriteSecrets: boolean }) {
  return (
    <ActionForm action={save} submitLabel="Save settings" disabled={!canWrite} inlineErrors cta="settings-save">
      {(state) => (
        <fieldset disabled={!canWrite} className="flex flex-col gap-6">
          {groupFields(fields).map(({ group, fields: list }) => (
            <section key={group} className="flex flex-col gap-4 rounded-md border border-border bg-surface p-4 md:p-5">
              <h2 className="text-base font-semibold text-primary">{group}</h2>
              <div className="grid gap-4 md:grid-cols-2">
                {list.map((f) => (
                  <Field key={f.key} field={f} error={state.fieldErrors?.[f.key]?.join(', ')} canWriteSecrets={canWriteSecrets} />
                ))}
              </div>
            </section>
          ))}
        </fieldset>
      )}
    </ActionForm>
  );
}

const when = (iso: string) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(iso));

/** `settings.actions[]` as buttons: Test connection, Test send, Sync now, Connect (OAuth redirect). */
export function SettingsActionsIsland({ actions, run }: { actions: SettingsActionView[]; run: (actionId: string) => Promise<ActionOutcome> }) {
  const [last, setLast] = useState(() => Object.fromEntries(actions.map((a) => [a.id, a.last])));
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const click = (a: SettingsActionView) => {
    setBusy(a.id);
    startTransition(async () => {
      const result = await run(a.id);
      setBusy(null);
      setLast((prev) => ({ ...prev, [a.id]: { at: new Date().toISOString(), ok: result.ok, message: result.message } }));
      if (result.redirectUrl) return window.location.assign(result.redirectUrl);
      (result.ok ? toast.success : toast.error)(result.message);
    });
  };
  return (
    <ul className="flex flex-col gap-3">
      {actions.map((a) => {
        const l = last[a.id];
        return (
          <li key={a.id} className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant={a.kind === 'oauth-redirect' ? 'primary' : 'outline'} disabled={!a.allowed || busy !== null} aria-busy={busy === a.id} onClick={() => click(a)} data-cta={`settings-action-${a.id}`}>
              {a.label}
            </Button>
            <span role="status" className={cn('text-xs', l ? (l.ok ? 'text-success' : 'text-danger') : 'text-muted')}>
              {l ? `${l.ok ? 'OK' : 'Failed'}: ${l.message} (${when(l.at)})` : 'Not run yet'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** A webhook or redirect URL with a copy button. */
export function CopyIsland({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <code className={cn(fieldClass, 'overflow-x-auto py-2 text-xs whitespace-nowrap')}>{value}</code>
      <Button
        size="icon"
        variant="subtle"
        aria-label={`Copy ${label}`}
        onClick={() =>
          navigator.clipboard.writeText(value).then(
            () => toast.success('Copied'),
            () => toast.error('Could not copy; select the text instead.'),
          )
        }
      >
        <Copy aria-hidden="true" />
      </Button>
    </div>
  );
}
