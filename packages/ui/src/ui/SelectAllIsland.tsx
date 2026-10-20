'use client';

/** Header checkbox for DataTable bulk selection: ticks every `ids` checkbox in the same form. */
export function SelectAllIsland({ label }: { label: string }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      className="size-4 accent-primary"
      onChange={(e) => {
        for (const box of e.currentTarget.form?.querySelectorAll<HTMLInputElement>('input[name=ids]') ?? []) box.checked = e.currentTarget.checked;
      }}
    />
  );
}
