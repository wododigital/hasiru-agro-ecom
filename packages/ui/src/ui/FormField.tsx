import type { ReactNode } from 'react';
import { cn } from '../cn';

export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}

export interface FormFieldProps {
  id: string;
  label: ReactNode;
  help?: ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
  /** Render prop gets the ids to spread on the control so label, help and error are announced. */
  children: (control: FieldControlProps) => ReactNode;
}

export function FormField({ id, label, help, error, required, className, children }: FormFieldProps) {
  const helpId = help ? `${id}-help` : null;
  const errorId = error ? `${id}-error` : null;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-semibold text-primary">
        {label}
        {required ? <span aria-hidden="true" className="text-danger">*</span> : null}
      </label>
      {children({ id, 'aria-describedby': describedBy, ...(error ? { 'aria-invalid': true as const } : {}) })}
      {help ? (
        <p id={helpId!} className="text-xs text-muted">
          {help}
        </p>
      ) : null}
      {error ? (
        <p id={errorId!} className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
