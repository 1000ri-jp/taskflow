'use client';

import { Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ControlHint } from '@/components/ui/control-hint';
import { TASK_VIEWS } from '@/lib/board/taskViews';
import type { ProjectView } from '@/lib/board/projectNavigation';

export function TaskViewSwitcher({ view, primaryView, onChange, onSetDefault, canSave, persistenceFailed }: {
  view: ProjectView; primaryView: ProjectView; onChange: (view: ProjectView) => void; onSetDefault: () => void; canSave: boolean; persistenceFailed: boolean;
}) {
  const isPrimary = view === primaryView;
  return <div className="flex items-center gap-1">
    <ControlHint label={isPrimary ? '自分の主表示（このブラウザ）' : '自分の主表示にする'} description="このプロジェクトを最初に開く表示を、自分用にこのブラウザへ保存します。他のメンバーには影響しません。"><span className="inline-flex" tabIndex={!canSave || isPrimary ? 0 : undefined}><Button
      type="button"
      size="sm"
      variant={isPrimary ? 'ghost' : 'outline'}
      disabled={!canSave || isPrimary}
      onClick={onSetDefault}
      aria-label={isPrimary ? '自分の主表示（このブラウザ）' : '自分の主表示にする'}
      className="h-8 w-8 p-0"
    >
      <Star className="h-3.5 w-3.5" />
    </Button></span></ControlHint>
    <label htmlFor="task-view-select" className="sr-only">タスクの表示切り替え</label>
    <select
      id="task-view-select"
      aria-label="タスクの表示切り替え"
      value={view}
      onChange={(event) => onChange(event.target.value as ProjectView)}
      className="h-8 min-w-28 rounded-md border bg-background px-2 text-sm font-medium shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
    >
      {TASK_VIEWS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      <option value="gantt">ガントチャート</option>
    </select>

    {persistenceFailed && <span role="alert" className="text-xs text-destructive">保存できません</span>}
  </div>;
}
