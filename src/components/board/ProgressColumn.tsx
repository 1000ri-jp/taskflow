'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { MoreHorizontal } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { isBoardSort, sortBoardTasks, type BoardSort } from '@/lib/board/sort';
import { type BoardDisplaySettings } from '@/stores/boardDisplayStore';
import { TASK_STATUSES } from '@/lib/task/status';
import { cn } from '@/lib/utils';
import type { Task } from '@/types';
import { ListColorPalette } from './ListColorPalette';
import { ColumnDisplayOptions, COLUMN_DISPLAY_FIELDS } from './ColumnDisplayOptions';

type Settings = { sort: BoardSort; color: string; display: Partial<BoardDisplaySettings> };
const defaults: Settings = { sort: 'due-asc', color: '', display: { showListName: true } };
const fields = COLUMN_DISPLAY_FIELDS;

export function ProgressColumn({ status, tasks, projectId, viewerId, disabled, children }: {
  status: typeof TASK_STATUSES[number]; tasks: Task[]; projectId: string; viewerId: string; disabled: boolean;
  children: (task: Task, display: Partial<BoardDisplaySettings>) => ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `progress:${status.id}`, disabled });
  const key = `taskflow.progressColumn.v1:${JSON.stringify([viewerId, projectId, status.id])}`;
  const [settings, setSettings] = useState<Settings>(defaults);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      try {
        const saved = JSON.parse(localStorage.getItem(key) || 'null');
        const display: Partial<BoardDisplaySettings> = { ...defaults.display };
        for (const [field] of fields) if (typeof saved?.display?.[field] === 'boolean') display[field] = saved.display[field];
        setSettings({ sort: isBoardSort(saved?.sort) ? saved.sort : defaults.sort, color: /^#[0-9a-f]{6}$/i.test(saved?.color ?? '') ? saved.color : '', display });
      } catch { setStorageError(true); }
    });
    return () => { active = false; };
  }, [key]);
  const save = (next: Settings) => {
    setSettings(next);
    try { localStorage.setItem(key, JSON.stringify(next)); setStorageError(false); }
    catch { setStorageError(true); }
  };
  const sorted = sortBoardTasks(tasks, settings.sort);
  return <section ref={setNodeRef} aria-label={status.label} className={cn('flex w-72 min-w-72 shrink-0 flex-col rounded-lg bg-gray-100', isOver && 'ring-2 ring-primary bg-gray-200')}>
    <div className="flex shrink-0 items-center gap-2 p-3 pb-2">
      <span className={cn('h-3 w-3 shrink-0 rounded-full', !settings.color && status.dot)} style={settings.color ? { backgroundColor: settings.color } : undefined} aria-hidden="true" />
      <h2 className="font-semibold">{status.label}</h2><span className="text-xs text-muted-foreground" title="親タスクの件数。サブタスクは各カードの中に表示します">{tasks.length}件</span>
      <Popover><PopoverTrigger asChild><Button variant="ghost" size="icon" className="ml-auto h-8 w-8" aria-label={`${status.label}列の設定`}><MoreHorizontal className="h-4 w-4" /></Button></PopoverTrigger>
        <PopoverContent align="end" className="w-64 max-h-[var(--radix-popover-content-available-height)] space-y-3 overflow-y-auto">
          <ColumnDisplayOptions name={status.label} sort={settings.sort} display={settings.display} onSort={sort => save({ ...settings, sort })} onDisplay={display => save({ ...settings, display })} onReset={() => save(defaults)} error={storageError}>
            <div className="space-y-2"><p className="text-xs text-muted-foreground">カラー</p><ListColorPalette label={`${status.label}の色`} value={settings.color} onChange={color => save({ ...settings, color })} /></div>
          </ColumnDisplayOptions>
        </PopoverContent>
      </Popover>
    </div>
    <SortableContext items={sorted.map(task => task.id)} strategy={verticalListSortingStrategy}>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {!tasks.length && <p className="px-1 py-4 text-xs text-muted-foreground">タスクなし</p>}
        {sorted.map(task => children(task, settings.display))}
      </div>
    </SortableContext>
  </section>;
}
