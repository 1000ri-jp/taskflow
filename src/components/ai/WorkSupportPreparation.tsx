"use client";
import { useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useAISettingsStore } from '@/stores/aiSettingsStore';
import { requestWorkSupport } from '@/lib/ai/support/workClient';
import { workSupportVersion, type WorkPreparation } from '@/lib/ai/support/workContext';
import type { Task, Checklist } from '@/types';
export function WorkSupportPreparation({ task, tasks, userId, purpose, preferenceKey, once, onConsumed, disabled, actions, checklists }: {
  task: Task; tasks: Task[]; userId: string; purpose: string; preferenceKey: string; once: string; onConsumed: () => void; disabled: boolean; actions?: ReactNode; checklists?: readonly Checklist[];
}) {
  const settings = useAISettingsStore();
  const version = workSupportVersion(task, tasks, userId, purpose, checklists) + preferenceKey;
  const [result, setResult] = useState<{ version: string; value: WorkPreparation } | null>(null);
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const [error, setError] = useState('');
  const visible = !disabled && result?.version === version ? result.value : null;
  return <section aria-label="この仕事のAIの準備" className="space-y-2">
    <div className="flex flex-wrap items-start gap-2">
    <Button type="button" size="sm" variant="outline" disabled={busy || disabled} onClick={async () => {
      if (guard.current) return; guard.current = true; setBusy(true); setError(''); setResult(null);
      try {
        const value = await requestWorkSupport(userId, task.projectId, task.id, settings.provider, settings.getActiveModel(), once);
        setResult({ version, value }); onConsumed();
      } catch (error) { setError(error instanceof Error ? error.message : '整理できませんでした。'); }
      finally { guard.current = false; setBusy(false); }
    }}>{busy ? '確認点を整理中…' : 'モアイに相談'}</Button>
    {actions}
    </div>
    {result && !visible && <p className="text-xs text-muted-foreground">仕事または手伝い方が変わりました。最新の内容で整理できます。</p>}
    {visible && <div className="space-y-2 rounded-md border p-3 text-sm"><p className="text-xs text-muted-foreground">{visible.mock ? '隔離環境の表示例・AI未実行' : 'AIが用意した確認メモ'} · {visible.role}</p><p className="whitespace-pre-wrap break-words">{visible.text}</p><p className="text-xs text-muted-foreground">根拠：依頼文・提出者の修正メモ・関係する仕事。資料本文の差分は未確認です。</p></div>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </section>;
}
