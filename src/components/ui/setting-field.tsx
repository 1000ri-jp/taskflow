import type { ReactNode } from 'react';
import { Button } from './button';
import { HelpText } from './typography';

/** Presentation only. The caller owns persistence, permissions and the retained draft. */
export function SettingField({ id, label, description, children, onSave, saveLabel = '保存', busy = false, disabled = false, error, message }: {
  id: string; label: string; description: string; children: ReactNode;
  onSave: () => void; saveLabel?: string; busy?: boolean; disabled?: boolean; error?: string; message?: string;
}) {
  return <div className="space-y-2" aria-busy={busy}>
    <label htmlFor={id} className="text-sm font-medium">{label}</label>
    <div className="flex flex-wrap items-center gap-2">{children}<Button type="button" size="sm" disabled={disabled || busy} onClick={onSave}>{busy ? '保存中…' : saveLabel}</Button></div>
    <HelpText>{description}</HelpText>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </div>;
}
export const settingSelect = 'h-9 min-w-0 max-w-full rounded-md border bg-background px-2 text-sm';
