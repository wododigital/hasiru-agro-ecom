'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../cn';
import { uiMessages } from '../messages';
import { Button } from './Button';
import { fieldClass } from './Input';

export interface SecretFieldProps {
  id: string;
  name: string;
  /** Already masked on the server (core.settings.maskSecret: last 4 only) or null when unset. Never the secret itself. */
  masked: string | null;
  placeholder?: string;
  labels?: Partial<(typeof uiMessages)['secret']>;
  'aria-describedby'?: string;
  className?: string;
}

/**
 * Write-only secret input for settings forms. Shows the masked value; "Replace" reveals an empty
 * input. While untouched the field submits nothing, so the server keeps the stored value.
 */
export function SecretField({ id, name, masked, placeholder, labels, className, ...aria }: SecretFieldProps) {
  const l = { ...uiMessages.secret, ...labels };
  const [editing, setEditing] = useState(masked === null);
  const [visible, setVisible] = useState(false);

  if (!editing) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <output id={id} className={cn(fieldClass, 'font-mono text-muted')} {...aria}>
          {masked ?? l.notSet}
        </output>
        <Button size="sm" variant="subtle" onClick={() => setEditing(true)}>
          {l.replace}
        </Button>
      </div>
    );
  }
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="relative w-full">
        <input
          id={id}
          name={name}
          type={visible ? 'text' : 'password'}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          className={cn(fieldClass, 'pr-11 font-mono')}
          {...aria}
        />
        <button type="button" onClick={() => setVisible((v) => !v)} aria-label={visible ? l.hide : l.show} aria-pressed={visible} className="absolute inset-y-0 right-1 my-auto grid size-9 place-items-center rounded-sm text-muted hover:text-text">
          {visible ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}
        </button>
      </div>
      {masked !== null ? (
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
          {l.cancel}
        </Button>
      ) : null}
    </div>
  );
}
