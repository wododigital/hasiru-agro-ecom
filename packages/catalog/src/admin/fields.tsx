import { Checkbox, Input, Select, Textarea } from '@ecomkit/ui';
import type { ReactNode } from 'react';

const label = (name: string) => `f-${name.replace(/[^a-zA-Z0-9]/g, '-')}`;

export function TextField({ name, label: text, value, type = 'text', help, required, step }: { name: string; label: string; value: string | number | null | undefined; type?: string; help?: string; required?: boolean; step?: string }) {
  const id = label(name);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold">
        {text}
      </label>
      <Input id={id} name={name} type={type} step={step} defaultValue={value ?? ''} required={required} />
      {help ? <p className="text-xs text-muted">{help}</p> : null}
    </div>
  );
}

export function AreaField({ name, label: text, value, rows = 4, help }: { name: string; label: string; value: string | null | undefined; rows?: number; help?: string }) {
  const id = label(name);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold">
        {text}
      </label>
      <Textarea id={id} name={name} rows={rows} defaultValue={value ?? ''} />
      {help ? <p className="text-xs text-muted">{help}</p> : null}
    </div>
  );
}

export function SelectField({ name, label: text, value, options, blank = true }: { name: string; label: string; value: string | null | undefined; options: readonly (string | { value: string; label: string })[]; blank?: boolean }) {
  const id = label(name);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold">
        {text}
      </label>
      <Select id={id} name={name} defaultValue={value ?? ''}>
        {blank ? <option value="">-</option> : null}
        {options.map((o) => {
          const opt = typeof o === 'string' ? { value: o, label: o.replace(/_/g, ' ') } : o;
          return (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          );
        })}
      </Select>
    </div>
  );
}

export function CheckField({ name, label: text, checked, value = 'on' }: { name: string; label: string; checked: boolean; value?: string }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox name={name} value={value} defaultChecked={checked} />
      {text}
    </label>
  );
}

export function Grid({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}
