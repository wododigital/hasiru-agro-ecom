import type { FieldSpec } from './fields';

/** Pure list operations behind the block, menu and nested-row editors (the island only holds state). */
export type Path = readonly (string | number)[];

export function moveItem<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
  const next = [...list];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}

export function removeItem<T>(list: readonly T[], index: number): T[] {
  return list.filter((_, i) => i !== index);
}

/** Immutable set at a path of object keys and array indexes; missing containers are created. */
export function setIn<T>(root: T, path: Path, value: unknown): T {
  if (!path.length) return value as T;
  const [head, ...rest] = path;
  const container: unknown = root ?? (typeof head === 'number' ? [] : {});
  if (Array.isArray(container)) {
    const copy = [...container];
    copy[head as number] = setIn(copy[head as number], rest, value);
    return copy as T;
  }
  const obj = container as Record<string, unknown>;
  return { ...obj, [head as string]: setIn(obj[head as string], rest, value) } as T;
}

export function getIn(root: unknown, path: Path): unknown {
  return path.reduce<unknown>((acc, key) => (acc == null ? undefined : (acc as Record<string | number, unknown>)[key]), root);
}

/** A blank row for a field list: '' for text, false for checkboxes, [] for lists. */
export function emptyValues(fields: readonly FieldSpec[]): Record<string, unknown> {
  return Object.fromEntries(fields.map((f) => [f.name, f.kind === 'checkbox' ? false : f.kind === 'items' || f.kind === 'media-list' ? [] : '']));
}
