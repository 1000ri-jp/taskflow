'use client';

import { useEffect } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useBoardDisplayStore, type BoardDisplaySettings as Settings } from '@/stores/boardDisplayStore';
import { useBoardSortStore } from '@/stores/boardSortStore';
import { BOARD_SORT_OPTIONS, isBoardSort } from '@/lib/board/sort';

const options: { key: keyof Settings; label: string }[] = [
  { key: 'showListName', label: '列名' },
  { key: 'showAssignees', label: '担当者' },
  { key: 'showTags', label: 'タグ' },
  { key: 'showPriority', label: '優先度' },
];

export function BoardDisplaySettings({ projectId }: { projectId?: string }) {
  const { settings, hydrate, setOption, reset } = useBoardDisplayStore();
  const { byProject, hydrate: hydrateSort, setSort, persistenceFailed } = useBoardSortStore();

  useEffect(() => { hydrate(); hydrateSort(); }, [hydrate, hydrateSort]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8">
          <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
          表示設定
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 max-h-[var(--radix-popover-content-available-height)] space-y-3 overflow-y-auto" align="end">
        {projectId && <div className="space-y-2 border-b pb-3">
          <label className="block space-y-2 text-sm font-medium">
            <span>タスクの並び順</span>
            <select className="h-9 w-full rounded-md border bg-background px-2 text-sm font-normal"
              value={byProject[projectId] ?? 'manual'} onChange={event => { if (isBoardSort(event.target.value)) setSort(projectId, event.target.value); }}>
              {BOARD_SORT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <p className="text-xs leading-relaxed text-muted-foreground">このプロジェクトの各列に適用。このブラウザだけに保存します。完了済みは下、日付未設定は各グループの末尾です。</p>
          {(byProject[projectId] ?? 'manual') !== 'manual' && <p className="text-xs text-muted-foreground">日付順の間はカードのドラッグ移動を停止します。手動で動かす場合は「元の並び順」に戻してください。</p>}
          {persistenceFailed && <p role="alert" className="text-xs text-destructive">並び順をブラウザに保存できません。この画面内のみ適用します。</p>}
        </div>}
        <p className="text-sm font-medium">カード下部に表示</p>
        <div className="space-y-1">
          {options.map(({ key, label }) => (
            <label key={key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 hover:bg-muted">
              <Checkbox checked={settings[key]} onCheckedChange={(checked) => setOption(key, checked === true)} />
              <span className="text-sm">{label}</span>
            </label>
          ))}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          このブラウザの全ボードに適用します。タスクのデータは変更しません。
        </p>
        <Button variant="ghost" size="sm" className="w-full" onClick={() => { reset(); if (projectId) setSort(projectId, 'manual'); }}>初期設定に戻す</Button>
      </PopoverContent>
    </Popover>
  );
}
