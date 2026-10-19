import type { ReactNode } from 'react';
import { cn } from '../cn';

export interface SegmentedOption {
  value: string;
  label: ReactNode;
}

export interface SegmentedProps {
  /** Form field name; also scopes the radio group. */
  name: string;
  /** Group name for screen readers. */
  label: string;
  options: readonly SegmentedOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  className?: string;
}

/**
 * Two to four mutually exclusive choices (acre / sq ft, square / triangular, Desi / Exotic).
 * Native radios: arrow keys, forms and no-JS all work.
 */
export function Segmented({ name, label, options, value, defaultValue, onChange, className }: SegmentedProps) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex w-fit rounded-full bg-surface-2 p-1', className)}>
      {options.map((o) => (
        <label
          key={o.value}
          className="cursor-pointer rounded-full px-3.5 py-1.5 text-sm font-semibold text-primary transition-colors has-checked:bg-primary has-checked:text-primary-fg has-focus-visible:outline-2 has-focus-visible:outline-ring"
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            className="sr-only"
            {...(value !== undefined ? { checked: value === o.value, onChange: () => onChange?.(o.value) } : { defaultChecked: defaultValue === o.value, onChange: onChange ? () => onChange(o.value) : undefined })}
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}
