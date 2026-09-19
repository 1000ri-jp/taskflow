'use client';
import type { ComponentType } from 'react';
import { Button } from './button';

export function ViewSwitcher<T extends string>({ label, value, options, onChange, disabled = false }: {
  label: string;
  value: T;
  options: readonly { id: T; label: string; icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean }> }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return <div role="group" aria-label={label} className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl border bg-card p-1">
    {options.map(option => <Button key={option.id} type="button" size="sm" variant={value === option.id ? 'default' : 'ghost'}
      disabled={disabled} aria-label={option.label} aria-pressed={value === option.id} onClick={() => onChange(option.id)} className="gap-1.5 rounded-lg">
      {option.icon && <option.icon className="size-4" aria-hidden />}{option.label}
    </Button>)}
  </div>;
}
