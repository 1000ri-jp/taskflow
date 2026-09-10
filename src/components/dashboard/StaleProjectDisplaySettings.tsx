'use client';

import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useProjects } from '@/hooks/useProjects';
import { useStaleProjectDisplayStore } from '@/stores/staleProjectDisplayStore';

export function StaleProjectDisplaySettings() {
  const { projects, isLoading, error } = useProjects();
  const { hiddenProjectIds, setVisible } = useStaleProjectDisplayStore();
  const hiddenCount = projects.filter((project) => hiddenProjectIds.includes(project.id)).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-xs text-muted-foreground" aria-label="3日動いていないの表示設定">
          <SlidersHorizontal className="h-3 w-3" />{hiddenCount > 0 && `${hiddenCount}プロジェクト非表示`}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-h-[var(--radix-popover-content-available-height)] w-80 max-w-[calc(100vw-2rem)] space-y-3 overflow-y-auto" align="start" side="right" collisionPadding={16}>
        <p className="text-sm font-medium">「3日動いていない」に表示するプロジェクト</p>
        <p className="text-xs text-muted-foreground">チェックを外すと、この欄だけ非表示になります。</p>
        {isLoading ? <p className="text-sm text-muted-foreground">プロジェクトを読み込み中…</p>
          : error ? <p role="alert" className="text-sm text-rose-700">プロジェクトを読み込めませんでした。設定は保持しています。</p>
          : projects.length === 0 ? <p className="text-sm text-muted-foreground">選択できるプロジェクトがありません。</p>
          : <>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setVisible(projects.map((project) => project.id), true)}>すべて表示</Button>
              <Button variant="ghost" size="sm" onClick={() => setVisible(projects.map((project) => project.id), false)}>すべて非表示</Button>
            </div>
            <div className="max-h-60 space-y-1 overflow-y-auto">
              {projects.map((project) => (
                <label key={project.id} className="flex cursor-pointer items-start gap-2 rounded px-2 py-2 hover:bg-muted">
                  <Checkbox className="mt-0.5" aria-label={project.name} checked={!hiddenProjectIds.includes(project.id)}
                    onCheckedChange={(checked) => setVisible([project.id], checked === true)} />
                  <span className="min-w-0 break-words text-sm">{project.name}</span>
                </label>
              ))}
            </div>
          </>}
        <p className="text-xs leading-relaxed text-muted-foreground">設定はこのブラウザだけに保存します。「今日やる」・直近3日・受信箱や、元のプロジェクト・タスクは変更しません。</p>
      </PopoverContent>
    </Popover>
  );
}
