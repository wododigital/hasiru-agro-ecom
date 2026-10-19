'use client';

import { Button, Checkbox, Input, Select, Textarea } from '@ecomkit/ui';
import { useId, useState } from 'react';
import { emptyValues, moveItem, removeItem, setIn, type FieldSpec, type Path } from '../domain';

type Row = Record<string, unknown>;
export interface EditorType {
  label: string;
  fields: readonly FieldSpec[];
}

function Control({ field, value, onChange, id }: { field: FieldSpec; value: unknown; onChange: (v: unknown) => void; id: string }) {
  const str = value == null ? '' : String(value);
  switch (field.kind) {
    case 'checkbox':
      return <Checkbox id={id} checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
    case 'textarea':
      return <Textarea id={id} rows={3} value={str} onChange={(e) => onChange(e.target.value)} />;
    case 'html':
      return <Textarea id={id} rows={10} className="font-mono text-sm" value={str} onChange={(e) => onChange(e.target.value)} />;
    case 'media-list':
      return (
        <Textarea
          id={id}
          rows={3}
          className="font-mono text-sm"
          placeholder="One id per line"
          value={Array.isArray(value) ? value.join('\n') : str}
          onChange={(e) => onChange(e.target.value.split(/[\s,]+/).filter(Boolean))}
        />
      );
    case 'number':
      return <Input id={id} type="number" value={str} onChange={(e) => onChange(e.target.value)} />;
    case 'select':
      return (
        <Select id={id} value={str} onChange={(e) => onChange(e.target.value)}>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      );
    default:
      return <Input id={id} className={field.kind === 'media' ? 'font-mono text-sm' : undefined} value={str} onChange={(e) => onChange(e.target.value)} />;
  }
}

function RowControls({ index, count, onMove, onRemove, label }: { index: number; count: number; onMove: (d: -1 | 1) => void; onRemove: () => void; label: string }) {
  return (
    <div className="flex gap-1">
      <Button type="button" variant="ghost" size="sm" disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Move ${label} up`}>
        Up
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={index === count - 1} onClick={() => onMove(1)} aria-label={`Move ${label} down`}>
        Down
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label={`Remove ${label}`}>
        Remove
      </Button>
    </div>
  );
}

function Fields({ fields, row, path, set, idBase }: { fields: readonly FieldSpec[]; row: Row; path: Path; set: (path: Path, value: unknown) => void; idBase: string }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {fields.map((f) => {
        const id = `${idBase}-${path.join('-')}-${f.name}`;
        if (f.kind === 'items') {
          const rows = (Array.isArray(row[f.name]) ? row[f.name] : []) as Row[];
          return (
            <fieldset key={f.name} className="flex flex-col gap-2 rounded-md border border-border p-3 md:col-span-2">
              <legend className="px-1 text-sm font-semibold">{f.label}</legend>
              {rows.map((sub, i) => (
                <div key={i} className="flex flex-col gap-2 rounded-md bg-surface-2 p-3">
                  <RowControls
                    index={i}
                    count={rows.length}
                    label={`${f.label} ${i + 1}`}
                    onMove={(d) => set([...path, f.name], moveItem(rows, i, d))}
                    onRemove={() => set([...path, f.name], removeItem(rows, i))}
                  />
                  <Fields fields={f.fields ?? []} row={sub} path={[...path, f.name, i]} set={set} idBase={idBase} />
                </div>
              ))}
              <Button type="button" variant="subtle" size="sm" className="self-start" onClick={() => set([...path, f.name], [...rows, emptyValues(f.fields ?? [])])}>
                {`Add to ${f.label.toLowerCase()}`}
              </Button>
            </fieldset>
          );
        }
        return (
          <div key={f.name} className={f.kind === 'html' || f.kind === 'textarea' ? 'flex flex-col gap-1 md:col-span-2' : 'flex flex-col gap-1'}>
            <label htmlFor={id} className="text-sm font-semibold text-primary">
              {f.label}
              {f.required ? <span aria-hidden="true" className="text-danger">*</span> : null}
            </label>
            <Control field={f} value={row[f.name]} onChange={(v) => set([...path, f.name], v)} id={id} />
            {f.help ? <p className="text-xs text-muted">{f.help}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Ordered list editor for typed rows: the block editor (`types` = every block type, rows `{ type, data }`) and the
 * menu editor (one type, rows are the data). Posts the list as JSON in a hidden field named `name`; the server
 * validates it with the same zod schemas.
 */
export function ListEditorIsland({ name, types, initial, rowsHaveType = true, addLabel = 'Add' }: { name: string; types: Readonly<Record<string, EditorType>>; initial: readonly Row[]; rowsHaveType?: boolean; addLabel?: string }) {
  const idBase = useId();
  const [rows, setRows] = useState<Row[]>(() => [...initial]);
  const typeKeys = Object.keys(types);
  const [adding, setAdding] = useState(typeKeys[0] ?? '');
  const set = (path: Path, value: unknown) => setRows((r) => setIn(r, path, value));

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name={name} value={JSON.stringify(rows)} />
      {rows.length === 0 ? <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted">Nothing here yet.</p> : null}
      {rows.map((row, i) => {
        const typeKey = rowsHaveType ? String(row.type) : typeKeys[0]!;
        const type = types[typeKey];
        const dataPath: Path = rowsHaveType ? [i, 'data'] : [i];
        const data = (rowsHaveType ? row.data : row) as Row;
        return (
          <section key={i} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4" aria-label={`${type?.label ?? typeKey} ${i + 1}`}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{`${i + 1}. ${type?.label ?? typeKey}`}</h3>
              <RowControls index={i} count={rows.length} label={`${type?.label ?? typeKey} ${i + 1}`} onMove={(d) => setRows((r) => moveItem(r, i, d))} onRemove={() => setRows((r) => removeItem(r, i))} />
            </div>
            {type ? <Fields fields={type.fields} row={data ?? {}} path={dataPath} set={set} idBase={idBase} /> : <p className="text-sm text-danger">Unknown type; remove it.</p>}
          </section>
        );
      })}
      <div className="flex flex-wrap items-center gap-2">
        {rowsHaveType && typeKeys.length > 1 ? (
          <Select aria-label="Type to add" value={adding} onChange={(e) => setAdding(e.target.value)} className="w-auto">
            {typeKeys.map((k) => (
              <option key={k} value={k}>
                {types[k]!.label}
              </option>
            ))}
          </Select>
        ) : null}
        <Button
          type="button"
          variant="subtle"
          onClick={() => setRows((r) => [...r, rowsHaveType ? { type: adding, data: emptyValues(types[adding]?.fields ?? []) } : emptyValues(types[typeKeys[0]!]?.fields ?? [])])}
        >
          {addLabel}
        </Button>
      </div>
    </div>
  );
}
