'use client';

import type { ReactNode } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { ControlHint } from '@/components/ui/control-hint';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Search, X, Calendar, CalendarCheck2, Tag, Eye, EyeOff, UserRound } from 'lucide-react';
import type { Label, List, Task } from '@/types';
import type { BoardFilters } from '@/lib/board/filters';
import { CommentedTasksPopover } from './CommentedTasksPopover';
import { BoardDisplaySettings } from './BoardDisplaySettings';

export type { BoardFilters } from '@/lib/board/filters';

interface BoardFilterBarProps {
  projectId: string;
  filters: BoardFilters;
  labels: Label[];
  tasks: Task[];
  lists: List[];
  onFiltersChange: (filters: BoardFilters) => void;
  onTaskClick: (taskId: string) => void;
  showCardSettings?: boolean;
  extraControls?: ReactNode;
  endControls?: ReactNode;
}

export function BoardFilterBar({
  projectId,
  filters,
  labels,
  tasks,
  lists,
  onFiltersChange,
  onTaskClick,
  showCardSettings = true,
  extraControls,
  endControls,
}: BoardFilterBarProps) {
  const userId = useAuthStore(state => state.user?.id);
  const hasActiveFilter =
    filters.keyword.length > 0 ||
    filters.labelIds.size > 0 ||
    filters.dueFilter !== 'all' ||
    !filters.showCompleted || !!filters.assigneeId;

  const activeFilterCount =
    (filters.keyword.length > 0 ? 1 : 0) +
    filters.labelIds.size +
    (filters.dueFilter !== 'all' ? 1 : 0) +
    (!filters.showCompleted ? 1 : 0) + (filters.assigneeId ? 1 : 0);

  const clearAllFilters = () => {
    onFiltersChange({
      keyword: '',
      labelIds: new Set(),
      dueFilter: 'all',
      showCompleted: true,
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 py-2 pl-4">
      <div className="relative w-48 max-w-full">
        <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
        <Input
          aria-label="タスクを検索"
          placeholder="タスクを検索..."
          className="h-8 pl-8 pr-8"
          value={filters.keyword}
          onChange={e => onFiltersChange({ ...filters, keyword: e.target.value })}
        />
        {filters.keyword && (
          <ControlHint label="検索をクリア"><Button type="button" variant="ghost" size="icon" className="absolute right-0.5 top-0.5 h-7 w-7" aria-label="検索をクリア" onClick={() => onFiltersChange({ ...filters, keyword: '' })}>
            <X className="h-3.5 w-3.5" />
          </Button></ControlHint>
        )}
      </div>
      {userId && <ControlHint label="自分の担当" description="自分が担当するタスク・サブタスクに絞り込みます。"><Button type="button" size="icon" className="h-8 w-8" aria-label="自分の担当" variant={filters.assigneeId ? 'default' : 'outline'} aria-pressed={!!filters.assigneeId} onClick={() => onFiltersChange({ ...filters, assigneeId: filters.assigneeId ? undefined : userId })}><UserRound className="h-4 w-4" /></Button></ControlHint>}

      {/* One-click view of unfinished work due by today */}
      <ControlHint label="今日やる" description="今日までが期限の未完了タスクを表示します。">
      <Button
        variant={filters.dueFilter === 'today' ? 'default' : 'outline'}
        size="sm"
        className="h-8 w-8 p-0"
        aria-label="今日やる"
        aria-pressed={filters.dueFilter === 'today'}
        onClick={() =>
          onFiltersChange({
            ...filters,
            dueFilter: filters.dueFilter === 'today' ? 'all' : 'today',
          })
        }
      >
        <CalendarCheck2 className="h-4 w-4" />
      </Button>
      </ControlHint>

      {/* Due date filter */}
      <Popover>
        <ControlHint label="期限" description="今週まで・期限切れ・期限なしなどで絞り込みます。">
        <PopoverTrigger asChild>
          <Button
            variant={
              filters.dueFilter !== 'all' && filters.dueFilter !== 'today'
                ? 'default'
                : 'outline'
            }
            size="sm"
            className="relative h-8 w-8 p-0" aria-label="期限"
          >
            <Calendar className="h-4 w-4" />
            {filters.dueFilter !== 'all' && (
              <Badge variant="secondary" aria-hidden="true" className="absolute -right-1 -top-1 h-3.5 min-w-3.5 justify-center px-0.5 text-[9px]">
                1
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        </ControlHint>
        <PopoverContent className="w-40" align="start">
          <div className="space-y-1">
            {[
              { value: 'all', label: 'すべて' },
              { value: 'today', label: '今日まで' },
              { value: 'week', label: '今週まで' },
              { value: 'overdue', label: '期限切れ' },
              { value: 'none', label: '期限なし' },
            ].map((option) => (
              <button
                key={option.value}
                className={`w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted ${
                  filters.dueFilter === option.value
                    ? 'bg-primary text-primary-foreground'
                    : ''
                }`}
                onClick={() =>
                  onFiltersChange({
                    ...filters,
                    dueFilter: option.value as BoardFilters['dueFilter'],
                  })
                }
              >
                {option.label}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Label filter */}
      <Popover>
        <ControlHint label="ラベル" description="タスクに付けたラベルで絞り込みます。">
        <PopoverTrigger asChild>
          <Button
            variant={filters.labelIds.size > 0 ? 'default' : 'outline'}
            size="sm"
            className="relative h-8 w-8 p-0" aria-label="ラベル"
          >
            <Tag className="h-4 w-4" />
            {filters.labelIds.size > 0 && (
              <Badge variant="secondary" aria-hidden="true" className="absolute -right-1 -top-1 h-3.5 min-w-3.5 justify-center px-0.5 text-[9px]">
                {filters.labelIds.size}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        </ControlHint>
        <PopoverContent className="w-48" align="start">
          <div className="space-y-1">
            {labels.length === 0 ? (
              <p className="py-2 text-center text-sm text-muted-foreground">
                ラベルがありません
              </p>
            ) : (
              labels.map((label) => (
                <label
                  key={label.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted"
                >
                  <Checkbox
                    checked={filters.labelIds.has(label.id)}
                    onCheckedChange={(checked) => {
                      const newSet = new Set(filters.labelIds);
                      if (checked) {
                        newSet.add(label.id);
                      } else {
                        newSet.delete(label.id);
                      }
                      onFiltersChange({ ...filters, labelIds: newSet });
                    }}
                  />
                  <div
                    className="h-3 w-3 rounded"
                    style={{ backgroundColor: label.color }}
                  />
                  <span className="text-sm">{label.name}</span>
                </label>
              ))
            )}
            {filters.labelIds.size > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 w-full"
                onClick={() =>
                  onFiltersChange({ ...filters, labelIds: new Set() })
                }
              >
                クリア
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Show completed toggle */}
      <ControlHint label={filters.showCompleted ? '完了タスクを隠す' : '完了タスクを表示'} description={filters.showCompleted ? '完了済みを隠して、残っている作業を見やすくします。' : '完了したタスクも一覧に表示します。'}>
      <Button
        variant={!filters.showCompleted ? 'default' : 'outline'}
        size="sm"
        className="h-8 w-8 p-0" aria-label="完了タスク" aria-pressed={filters.showCompleted}
        onClick={() =>
          onFiltersChange({ ...filters, showCompleted: !filters.showCompleted })
        }
      >
        {filters.showCompleted ? (
          <Eye className="h-4 w-4" />
        ) : (
          <EyeOff className="h-4 w-4" />
        )}
      </Button>
      </ControlHint>

      <CommentedTasksPopover
        iconOnly
        projectId={projectId}
        tasks={tasks}
        lists={lists}
        onTaskClick={onTaskClick}
      />
      {extraControls}

      {showCardSettings && <BoardDisplaySettings projectId={projectId} iconOnly />}

      {/* Clear all filters */}
      {hasActiveFilter && (
        <ControlHint label="フィルターをクリア" description="検索や絞り込みを解除し、完了タスクも表示します。リストの選択は維持します。">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-muted-foreground" aria-label={`フィルターをクリア (${activeFilterCount})`}
          onClick={clearAllFilters}
        >
          <X className="h-4 w-4" />
        </Button>
        </ControlHint>
      )}
      {endControls && <div className="ml-auto min-w-0 max-w-full">{endControls}</div>}
    </div>
  );
}
