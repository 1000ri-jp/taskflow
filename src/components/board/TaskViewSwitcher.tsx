'use client';

import { Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TASK_VIEWS, type TaskView } from '@/lib/board/taskViews';

export function TaskViewSwitcher({ view, primaryView, onChange, onSetDefault, canSave, persistenceFailed }: {
  view: TaskView; primaryView: TaskView; onChange: (view: TaskView) => void; onSetDefault: () => void; canSave: boolean; persistenceFailed: boolean;
}) {
  const isPrimary = view === primaryView;
  return <div className="flex items-center gap-1">
    <label htmlFor="task-view-select" className="sr-only">タスクの表示切り替え</label>
    <select
      id="task-view-select"
      aria-label="タスクの表示切り替え"
      value={view}
      onChange={(event) => onChange(event.target.value as TaskView)}
      className="h-8 min-w-28 rounded-md border bg-background px-2 text-sm font-medium shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
    >
      {TASK_VIEWS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select>
    <Button
      type="button"
      size="sm"
      variant={isPrimary ? 'ghost' : 'outline'}
      disabled={!canSave || isPrimary}
      onClick={onSetDefault}
      aria-label={isPrimary ? '主表示（このブラウザ）' : 'この表示を主表示にする'}
      title="このユーザー・このプロジェクトの主表示をブラウザに保存します"
      className="h-8 px-2"
    >
      <Star className="h-3.5 w-3.5" />
      <span className="hidden lg:inline">{isPrimary ? '主表示' : '主表示にする'}</span>
    </Button>
    {persistenceFailed && <span role="alert" className="text-xs text-destructive">保存できません</span>}
  </div>;
}
