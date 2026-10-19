import { Checkbox, FormField, Input, Select, Textarea } from '@ecomkit/ui';
import { dateToIstLocal, type FieldSpec } from '../domain';

/** Value as the form control wants it (dates as IST datetime-local, lists one per line). */
export function formValue(field: FieldSpec, value: unknown): string {
  if (value == null) return '';
  if (field.kind === 'datetime') return value instanceof Date ? dateToIstLocal(value) : String(value);
  if (field.kind === 'media-list') return Array.isArray(value) ? value.join('\n') : String(value);
  return String(value);
}

/** One uncontrolled form control for a FieldSpec (admin forms; `items` fields are edited in the list editor island). */
export function FieldInput({ field, value, prefix = 'f' }: { field: FieldSpec; value: unknown; prefix?: string }) {
  const id = `${prefix}-${field.name}`;
  if (field.kind === 'checkbox') {
    return (
      <label htmlFor={id} className="flex items-center gap-2 text-sm">
        <Checkbox id={id} name={field.name} defaultChecked={value === true} />
        {field.label}
      </label>
    );
  }
  return (
    <FormField id={id} label={field.label} help={field.help} required={field.required}>
      {(c) => {
        const common = { ...c, name: field.name, defaultValue: formValue(field, value), required: field.required };
        switch (field.kind) {
          case 'textarea':
            return <Textarea {...common} rows={3} />;
          case 'html':
            return <Textarea {...common} rows={12} className="font-mono text-sm" />;
          case 'media-list':
            return <Textarea {...common} rows={3} className="font-mono text-sm" placeholder="One media id per line" />;
          case 'number':
            return <Input {...common} type="number" step="any" inputMode="decimal" />;
          case 'datetime':
            return <Input {...common} type="datetime-local" />;
          case 'media':
            return <Input {...common} className="font-mono text-sm" placeholder="Media id" />;
          case 'select':
            return (
              <Select {...common}>
                {(field.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            );
          default:
            return <Input {...common} type="text" />;
        }
      }}
    </FormField>
  );
}
