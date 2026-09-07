'use client';

import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useTargetProjectStore } from '@/stores/targetProjectStore';
import type { Project } from '@/types';

export function TargetProjectSettings({ projects, isLoading, hasError }: {
  projects: Pick<Project, 'id' | 'name'>[];
  isLoading: boolean;
  hasError: boolean;
}) {
  const { selectedProjectIds, toggle, select } = useTargetProjectStore();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5" aria-label="今月の的に表示するプロジェクトを選択">
          <SlidersHorizontal className="h-3.5 w-3.5" />プロジェクトを選択
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 max-w-[calc(100vw-2rem)] space-y-3" align="end">
        <p className="text-sm font-medium">今月の的に表示するプロジェクト</p>
        {selectedProjectIds === null && <p className="text-xs text-muted-foreground">現在はサンプル表示です。選ぶと実際のプロジェクトの枠に切り替わります。</p>}
        {isLoading ? <p className="text-sm text-muted-foreground">プロジェクトを読み込み中…</p>
          : hasError ? <p role="alert" className="text-sm text-rose-700">プロジェクトを読み込めませんでした。選択内容は保持しています。</p>
          : projects.length === 0 ? <p className="text-sm text-muted-foreground">選択できるプロジェクトがありません。</p>
          : <>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => select(projects.map((project) => project.id))}>すべて選択</Button>
              <Button variant="ghost" size="sm" onClick={() => select([])}>すべて外す</Button>
            </div>
            <div className="max-h-60 overflow-y-auto space-y-1">
              {projects.map((project) => (
                <label key={project.id} className="flex cursor-pointer items-start gap-2 rounded px-2 py-2 hover:bg-muted">
                  <Checkbox className="mt-0.5" aria-label={project.name} checked={selectedProjectIds?.includes(project.id) ?? false}
                    onCheckedChange={(checked) => toggle(project.id, checked === true)} />
                  <span className="min-w-0 break-words text-sm">{project.name}</span>
                </label>
              ))}
            </div>
          </>}
        <p className="text-xs leading-relaxed text-muted-foreground">選んだプロジェクトの未完了タスクから、おすすめを最大3件ずつ自動表示します。プロジェクトの選択はこのブラウザだけに保存し、元のタスクは変更しません。</p>
        <Button variant="ghost" size="sm" className="w-full" onClick={() => select(null)}>サンプル表示に戻す</Button>
      </PopoverContent>
    </Popover>
  );
}
